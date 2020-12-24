# nexrender-action-transcode

Transcode all videos in assets to mp4 format with ffmpeg in prerender

## Installation

Install the module via Git :
```
npm i -g https://github.com/spenciefy/nexrender-action-transcode 
```

## Usage

Currently quite primitive, just converts all assets of type video into mp4 format. 

```
actions:{
    prerender:[{
        module: "nexrender-action-transcode",
        debug: true
    }]
},
```
