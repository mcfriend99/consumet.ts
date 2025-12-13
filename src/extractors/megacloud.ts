import { VideoExtractor, IVideo, ISubtitle, ISource } from '../models';
import { CheerioAPI, load } from 'cheerio';

export interface IMegaCloudOutput {
  headers: Record<string, string>;
  sources: Source[];
  tracks?: Track[];
  encrypted?: boolean;
  intro?: Timeskip;
  outro?: Timeskip;
  server?: number;
}

export interface Timeskip {
  start?: number;
  end?: number;
}

export interface Source {
  file?: string;
  type?: string;
}

export interface Track {
  file?: string;
  label?: string;
  kind?: string;
  default?: boolean;
}

class MegaCloud extends VideoExtractor {
  protected override serverName = 'MegaCloud';
  protected override sources: IVideo[] = [];

  override extract = async (videoUrl: URL, referer: string): Promise<ISource> => {
    try {
      const { data: embedData } = await this.client.get(videoUrl.href, {
        headers: {
          Referer: referer,
        }
      });

      const $ = load(embedData);
      const dataId = $("div[data-id]").attr("data-id")!;

      let nonce: string | null = null;

      // Try a single 48-char token first
      const regex48 = /\b[a-zA-Z0-9]{48}\b/;
      const match48 = embedData.match(regex48);
      if (match48 && match48[0]) {
        nonce = match48[0];
      } else {
        // Fallback: concatenate multiple 16-char tokens
        const regex16 = /"([a-zA-Z0-9]{16})"/g;
        const parts: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = regex16.exec(embedData)) !== null) {
          if (m[1]) parts.push(m[1]);
        }
        if (parts.length) nonce = parts.join("");
      }

      if (nonce) {
        const { data } = await this.client.get<IMegaCloudOutput>(
          `https://megacloud.blog/embed-2/v3/e-1/getSources`,
          {
            params: {
              id: dataId,
              _k: nonce,
            },
            headers: {
              Referer: videoUrl.href,
            },
          }
        );

        if (!data.sources || data.sources.length === 0) {
          throw new Error('No sources returned');
        }

        data.sources.forEach(src => this.sources.push({
          url: src.file || '',
          quality: src.type ?? 'auto',
          isM3U8: src.file?.includes('.m3u8') ?? false,
          isDASH: src.file?.includes('.mpd') ?? false,
        }));

        const subtitles: ISubtitle[] =
          data.tracks?.map(t => ({
            lang: t.label ?? 'Unknown',
            url: t.file || '',
            kind: t.kind ?? 'captions',
          })) ?? [];

        const result: ISource = {
          sources: this.sources,
          subtitles,
          intro: data.intro ? {
            start: data.intro.start!,
            end: data.intro.end!,
          } : { start: 0, end: 0 },
          outro: data.outro ? {
            start: data.outro.start!,
            end: data.outro.end!,
          } : { start: 0, end: 0 },
          headers: {
            ...data.headers,
            Referer: videoUrl.href,
          },
          embedURL: videoUrl.href,
        }

        return result;
      }

      return { sources: [], subtitles: [] }
    } catch (err) {
      throw new Error(`Failed to extract video sources for ${videoUrl.href}: ${(err as Error).message}`);
    }
  };
}

export default MegaCloud;
