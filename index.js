const fs = require('fs')
const path = require('path')
const pkg = require('./package.json')
const fetch = require('node-fetch')
const { spawn } = require('child_process')
const nfp = require('node-fetch-progress')

const getBinary = (job, settings) => {
    return new Promise((resolve, reject) => {
        const { version } = pkg['ffmpeg-static']
        const filename = `ffmpeg-${version}${process.platform == 'win32' ? '.exe' : ''}`
        const fileurl = `https://github.com/eugeneware/ffmpeg-static/releases/download/${version}/${process.platform}-x64`
        const output = path.join(settings.workpath, filename)

        if (fs.existsSync(process.env.NEXRENDER_FFMPEG)) {
            settings.logger.log(`> using external ffmpeg binary at: ${process.env.NEXRENDER_FFMPEG}`)
            return resolve(process.env.NEXRENDER_FFMPEG)
        }

        if (fs.existsSync(output)) {
            settings.logger.log(`> using an existing ffmpeg binary ${version} at: ${output}`)
            return resolve(output)
        }

        settings.logger.log(`> ffmpeg binary ${version} is not found`)
        settings.logger.log(`> downloading a new ffmpeg binary ${version} to: ${output}`)

        const errorHandler = (error) =>
            reject(
                new Error({
                    reason: 'Unable to download file',
                    meta: { fileurl, error },
                })
            )

        fetch(fileurl)
            .then((res) => (res.ok ? res : Promise.reject({ reason: 'Initial error downloading file', meta: { fileurl, error: res.error } })))
            .then((res) => {
                const progress = new nfp(res)

                progress.on('progress', (p) => {
                    process.stdout.write(
                        `${Math.floor(p.progress * 100)}% - ${p.doneh}/${p.totalh} - ${p.rateh} - ${p.etah}                       \r`
                    )
                })

                const stream = fs.createWriteStream(output)

                res.body.on('error', errorHandler).pipe(stream)

                stream.on('error', errorHandler).on('finish', () => {
                    settings.logger.log(`> ffmpeg binary ${version} was successfully downloaded`)
                    fs.chmodSync(output, 0o755)
                    resolve(output)
                })
            })
    })
}

/* pars of snippet taken from https://github.com/xonecas/ffmpeg-node/blob/master/ffmpeg-node.js#L136 */
const constructParams = (job, settings, { input, output, params }) => {
    let inputs = [input]

    if (params && params.hasOwnProperty('-i')) {
        const p = params['-i']

        if (Array.isArray(p)) {
            inputs.push(...p)
        } else {
            inputs.push(p)
        }

        delete params['-i']
    }

    inputs = inputs.map((i) => {
        if (path.isAbsolute(i)) return i
        return path.join(job.workpath, i)
    })

    settings.logger.log(`[${job.uid}] action-encode: input file ${inputs[0]}`)
    settings.logger.log(`[${job.uid}] action-encode: output file ${output}`)

    const baseParams = {
        '-i': inputs,
        '-ab': '128k',
        '-ar': '44100',
    }

    params = Object.assign(
        baseParams,
        {
            '-acodec': 'aac',
            '-vcodec': 'libx264',
            '-pix_fmt': 'yuv420p',
            '-r': '25',
        },
        params,
        {
            '-y': output,
        }
    )

    /* convert to plain array */
    return Object.keys(params).reduce((cur, key) => {
        const value = params[key]
        if (Array.isArray(value)) {
            value.forEach((item) => cur.push(key, item))
        } else {
            cur.push(key, value)
        }
        return cur
    }, [])
}

const convertToMilliseconds = (h, m, s) => (h * 60 * 60 + m * 60 + s) * 1000

const getDuration = (regex, data) => {
    const matches = data.match(regex)

    if (matches) {
        return convertToMilliseconds(parseInt(matches[1]), parseInt(matches[2]), parseInt(matches[3]))
    }

    return 0
}

const transcodeVideo = (job, settings, input) => {
    return new Promise((resolve, reject) => {
        let output = input.slice(0, -4) + '-encoded.mp4'

        settings.logger.log(`[${job.uid}] transcoding asset: ${input}`)

        const params = constructParams(job, settings, { input, output })
        const binary = getBinary(job, settings)
            .then((binary) => {
                if (settings.debug) {
                    settings.logger.log(`[${job.uid}] spawning ffmpeg process: ${binary} ${params.join(' ')}`)
                }
                const instance = spawn(binary, params)
                let totalDuration = 0

                instance.on('error', (err) => reject(new Error(`Error starting ffmpeg process: ${err}`)))
                instance.stderr.on('data', (data) => {
                    const dataString = data.toString()

                    // settings.logger.log(`[${job.uid}] ${dataString}`)

                    if (totalDuration === 0) {
                        totalDuration = getDuration(/(\d+):(\d+):(\d+).(\d+), start:/, dataString)
                    }

                    currentProgress = getDuration(/time=(\d+):(\d+):(\d+).(\d+) bitrate=/, dataString)

                    if (totalDuration > 0 && currentProgress > 0) {
                        const currentPercentage = Math.ceil((currentProgress / totalDuration) * 100)

                        settings.logger.log(`[${job.uid}] [${output}] encoding progress ${currentPercentage}%...`)
                    }
                })

                instance.stdout.on('data', (data) => settings.debug && settings.logger.log(`[${job.uid}] ${dataString}`))

                /* on finish (code 0 - success, other - error) */
                instance.on('close', (code) => {
                    if (code !== 0) {
                        return reject(new Error('Error in action-encode module (ffmpeg) code : ' + code))
                    }

                    settings.logger.log(`[${job.uid}] Completed transcoding, new asset ${output}`)
                    resolve(output)
                })
            })
            .catch((e) => {
                return reject(new Error('Error in action-encode module (ffmpeg) ' + e))
            })
    })
}

module.exports = async (job, settings, options, type) => {
    settings.logger.log(`[${job.uid}] starting action-encode action (ffmpeg)`)
    var promises = []
    return new Promise(async (resolve, reject) => {
        for (asset of job.assets) {
            if (asset.type === 'video') {
                settings.logger.log(`[${job.uid}] ${asset.layerName}`)
                let input = asset.dest
                const output = await transcodeVideo(job, settings, input)
                asset.dest = output
            }
        }

        settings.logger.log(`[${job.uid}] Completed transcoding:`)
        settings.logger.log(job)
        resolve(job)
    })
}
