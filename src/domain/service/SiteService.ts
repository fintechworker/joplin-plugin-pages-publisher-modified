import { container, singleton } from 'tsyringe';
import { Ref, ref, watchEffect, InjectionKey } from 'vue';
import { Theme, DEFAULT_THEME_NAME, defaultTheme } from '../model/Theme';
import { Site, defaultSite } from '../model/Site';
import { PluginDataRepository } from '../repository/PluginDataRepository';
import { ArticleService } from './ArticleService';

export const token: InjectionKey<SiteService> = Symbol('siteService');
@singleton()
export class SiteService {
  private readonly pluginDataRepository = new PluginDataRepository();
  readonly site: Ref<Site | null> = ref(null);
  readonly themes: Ref<Theme[]> = ref([]);
  private readonly articleService = container.resolve(ArticleService);
  constructor() {
    this.init();
  }
  private async init() {
    this.site.value = {
      ...defaultSite,
      ...(await this.pluginDataRepository.getSite()),
    };
    watchEffect(this.loadTheme.bind(this));
    watchEffect(this.loadArticles.bind(this));
    this.themes.value = await this.pluginDataRepository.getThemes();
  }

  private loadArticles() {
    if (!this.site.value) {
      throw new Error('site is not initialized');
    }

    this.site.value.articles = this.articleService.publishedArticles.value;
    this.site.value.tags = this.articleService.allTags;
  }

  private async loadTheme() {
    const site = this.site.value;

    if (!site) {
      throw new Error('site is not initialized');
    }

    const oldThemeName = site.themeConfig?.name;

    if (site.themeName === oldThemeName) {
      return;
    }

    const theme = await this.pluginDataRepository.getTheme(site.themeName);

    if (theme) {
      site.themeConfig = theme;
    } else {
      site.themeName = oldThemeName || DEFAULT_THEME_NAME;
      site.themeConfig = defaultTheme;
    }
  }

  async saveSite(site: Partial<Site>) {
    await this.pluginDataRepository.saveSite(Object.assign(this.site.value, site));
  }
}
