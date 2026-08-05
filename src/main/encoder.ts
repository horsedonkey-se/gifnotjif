import { runFfmpeg } from './ffmpeg';

export interface EncodeOptions {
  fps?: number;
  maxWidth?: number;
  colors?: number;
  dither?: string;
}

/**
 * Turns the recorded video into an animated GIF.
 *
 * Kept behind this one function so a different encoder (gifski produces
 * smoother gradients and smaller files) can be swapped in later without
 * touching anything else.
 */
export async function encodeGif(
  inPath: string,
  outPath: string,
  { fps = 12, maxWidth = 0, colors = 128, dither = 'none' }: EncodeOptions = {},
): Promise<string> {
  // `-1` keeps the aspect ratio; `force_divisible_by=2` stops the derived
  // height landing on an odd number, which some scalers refuse.
  const scale =
    maxWidth > 0
      ? `scale='min(${maxWidth},iw)':-1:flags=lanczos:force_divisible_by=2,`
      : '';

  // Two passes over the same stream. `stats_mode=diff` weights the palette
  // toward the pixels that actually change between frames, and
  // `diff_mode=rectangle` leaves the static background alone. Both matter far
  // more for a screencast than for video, because most of the frame is a still
  // background and a naive palette spends its 256 colours on that instead of
  // on the moving content.
  //
  // Dithering off by default. Screen content is mostly flat UI colours that
  // quantise cleanly, so a dither pattern adds noise the compressor then has
  // to store: measured on a real capture it cost 12% file size and, side by
  // side at 2x, made text no sharper and the flat areas visibly grainier.
  // Set `dither` to `bayer:bayer_scale=5` when recording gradients or video,
  // which is where it earns its keep.
  const filter =
    `fps=${fps},${scale}split[a][b];` +
    `[a]palettegen=max_colors=${colors}:stats_mode=diff[p];` +
    `[b][p]paletteuse=dither=${dither}:diff_mode=rectangle`;

  await runFfmpeg([
    '-hide_banner',
    '-i', inPath,
    '-filter_complex', filter,
    '-loop', '0',
    '-y', outPath,
  ]);

  return outPath;
}
