declare module "ffprobe-static" {
  const ffprobeStatic: { readonly path: string };
  export default ffprobeStatic;
}

declare module "ffmpeg-static/index.js" {
  const ffmpegPath: string | null;
  export default ffmpegPath;
}
