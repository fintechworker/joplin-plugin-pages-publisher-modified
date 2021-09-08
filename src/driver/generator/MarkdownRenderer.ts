import { trimStart, find } from 'lodash';
import { MarkupToHtml } from '@joplin/renderer';
import joplin from 'api';
import type { Article } from '../../domain/model/Article';
import type { Resource } from '../../domain/model/JoplinData';
import { outputFile, copy } from '../fs/joplinPlugin';
import type { File } from '../../domain/model/JoplinData';
import { fetchData, fetchAllData } from '../joplinData/joplinPlugin';
import { getMarkdownPluginAssetsDir, getOutputDir } from './pathHelper';
import type { RenderResultPluginAsset, ResourceMap } from './type';
import { sanitizeMarkdownHtml } from './htmlProcess';

const PLUGIN_SETTING_PREFIX = 'markdown.plugin.';
const AUDIO_PLAYER_PLUGIN = 'audioPlayer';
const VIDEO_PLAYER_PLUGIN = 'videoPlayer';
const PDF_VIEWER_PLUGIN = 'pdfViewer';

export class MarkdownRenderer {
  private mdPluginOptions?: Record<string, unknown>;
  private resources?: ResourceMap;
  private outputDir?: string;
  private pluginAssetDir?: string;
  private readonly fileIdPool = new Set();
  constructor(private readonly articles: Article[]) {}

  async init() {
    await this.getJoplinMarkdownSetting();
    await this.getAllResources();
    this.outputDir = await getOutputDir();
    this.pluginAssetDir = await getMarkdownPluginAssetsDir();
  }
  private async getAllResources() {
    const resources = await fetchAllData<Resource>(['resources'], {
      fields: 'id,mime,file_extension,encryption_applied,encryption_blob_encrypted',
    });

    this.resources = resources.reduce((result, resource) => {
      result[resource.id] = {
        extension: resource.file_extension,
        item: {
          mime: resource.mime,
          id: resource.id,
          encryption_blob_encrypted: resource.encryption_blob_encrypted,
          encryption_applied: resource.encryption_applied,
        },
        localState: { fetch_status: 2 },
      };
      return result;
    }, {} as ResourceMap);
  }

  private getResourceInfo(url: string) {
    if (!this.resources) {
      throw new Error('markdownRenderer is not initialized');
    }

    return this.resources[trimStart(url, ':/')];
  }

  private async getJoplinMarkdownSetting() {
    // @see https://github.com/laurent22/joplin/blob/1bc674a1f9a1f5021142d040459ef127db71ee62/packages/lib/models/Setting.ts#L873
    const pluginNames = [
      'softbreaks',
      'typographer',
      'linkify',
      'katex',
      'fountain',
      'mermaid',
      AUDIO_PLAYER_PLUGIN,
      VIDEO_PLAYER_PLUGIN,
      PDF_VIEWER_PLUGIN,
      'mark',
      'footnote',
      'toc',
      'sub',
      'sup',
      'deflist',
      'abbr',
      'emoji',
      'insert',
      'multitable',
    ];

    const values = await Promise.all<boolean>(
      pluginNames.map((name) => joplin.settings.globalValue(`${PLUGIN_SETTING_PREFIX}${name}`)),
    );

    this.mdPluginOptions = values.reduce((result, enabled, i) => {
      result[pluginNames[i]] = { enabled };
      return result;
    }, {} as Record<string, unknown>);
  }

  private readonly resourceModel = {
    isResourceUrl: (url: string) => Boolean(this.getResourceInfo(url)),
    urlToId: (url: string) => trimStart(url, ':/'),
    isSupportedImageMimeType: () => true,
  };

  async render(rawText: string, articlePageUrl: string) {
    if (!this.mdPluginOptions) {
      throw new Error('init failed');
    }

    const resourceIds: string[] = [];
    const markupToHtml = new MarkupToHtml({ ResourceModel: this.resourceModel });

    const { html, pluginAssets, cssStrings } = await markupToHtml.render(1, rawText, null, {
      pluginOptions: this.mdPluginOptions,
      bodyOnly: true,
      resources: this.resources,
      audioPlayerEnabled: this.mdPluginOptions[`${PLUGIN_SETTING_PREFIX}${AUDIO_PLAYER_PLUGIN}`],
      videoPlayerEnabled: this.mdPluginOptions[`${PLUGIN_SETTING_PREFIX}${VIDEO_PLAYER_PLUGIN}`],
      pdfViewerEnabled: this.mdPluginOptions[`${PLUGIN_SETTING_PREFIX}${PDF_VIEWER_PLUGIN}`],
      itemIdToUrl: (resourceId: string) => {
        const resourceInfo = this.getResourceInfo(resourceId);
        if (!resourceInfo) {
          // is note id
          const article = find(this.articles, { noteId: resourceId });
          return article ? `/${articlePageUrl}/${article.url}` : '';
        }
        resourceIds.push(resourceId);
        return `/_resources/${resourceId}.${resourceInfo.extension}`;
      },
    });

    const { sanitizedHtml, syntaxes } = sanitizeMarkdownHtml(html);

    return {
      resourceIds,
      html: sanitizedHtml,
      syntaxes,
      pluginAssets: pluginAssets.filter(({ name }: RenderResultPluginAsset) =>
        syntaxes.some((syntax) => name.includes(syntax)),
      ),
      cssStrings: cssStrings.filter(
        (cssString: string) =>
          syntaxes.some((syntax) => cssString.includes(syntax)) && !cssString.includes('joplin'),
      ),
    };
  }

  async outputResources(resourceIds: string[]) {
    if (!this.resources || !this.outputDir) {
      throw new Error('markdownRenderer is not initialized');
    }

    const { resources } = this;
    const resourceResult = resourceIds.map((id) => resources[id]);

    for (const [i, result] of resourceResult.entries()) {
      if (result) {
        const {
          item: { id },
          extension,
        } = result;
        const fileId = `resource: ${id}`;

        if (this.fileIdPool.has(fileId)) {
          continue;
        }

        try {
          const file = await fetchData<File>(['resources', id, 'file']);
          await outputFile(`${this.outputDir}/_resources/${id}.${extension}`, file.body);
          this.fileIdPool.add(fileId);
        } catch (error) {
          console.warn(`Fail to load File ${id}: ${error}`);
        }
      } else {
        console.warn(`Fail to load resource: ${resourceIds[i]}`);
      }
    }
  }

  async copyMarkdownPluginAssets(pluginAssets: RenderResultPluginAsset[]) {
    if (!this.outputDir || !this.pluginAssetDir) {
      throw new Error('markdownRenderer is not initialized');
    }

    for (const { name } of pluginAssets) {
      const fileId = `asset: ${name}`;
      if (this.fileIdPool.has(fileId)) {
        continue;
      }
      await copy(
        `${this.pluginAssetDir}/${name}`,
        `${this.outputDir}/_markdownPluginAssets/${name}`,
      );
      this.fileIdPool.add(fileId);
    }
  }
}
