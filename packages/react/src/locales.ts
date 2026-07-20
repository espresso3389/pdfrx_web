import { defaultPdfrxStrings, type PdfrxStrings } from './strings.js';

/**
 * The languages that ship with the package. English (`en`) is always the
 * fallback for any string a translation omits, and for any locale not listed
 * here. Chinese is split by script: `zh-Hans` (Simplified), `zh-Hant`
 * (Traditional).
 */
export type PdfrxLocale = 'en' | 'ja' | 'zh-Hans' | 'zh-Hant' | 'fr' | 'de';

/** The built-in locale codes, in no particular order. */
export const builtinPdfrxLocales: readonly PdfrxLocale[] = ['en', 'ja', 'zh-Hans', 'zh-Hant', 'fr', 'de'];

const ja: Partial<PdfrxStrings> = {
  toggleSidebar: 'サイドバーの表示切り替え',
  search: '検索',
  pageNumber: 'ページ番号',
  zoomOut: '縮小',
  zoomIn: '拡大',
  fitPage: 'ページ全体を表示',
  fitWidth: '幅に合わせる',
  print: '印刷',
  preparingToPrint: 'ページを準備中…',
  searchPlaceholder: '検索',
  previousMatch: '前の一致 (Shift+Enter)',
  nextMatch: '次の一致 (Enter)',
  clearSearch: '検索をクリア (Esc)',
  clearSearchLabel: '検索をクリア',
  closeSearch: '検索を閉じる',
  pagesTab: 'ページ',
  outlineTab: '目次',
  noOutline: '目次はありません',
  expand: '展開',
  collapse: '折りたたむ',
  goToPage: (n) => `${n} ページへ移動`,
  copy: 'コピー',
  selectAll: 'すべて選択',
  openFile: 'PDF ファイルを開く',
  download: 'ダウンロード',
  closeSidebar: 'サイドバーを閉じる',
  rotatePage: '時計回りに 90 度回転',
  deletePage: 'このページを削除',
  failedToOpen: (m) => `ドキュメントを開けませんでした: ${m}`,
};

const zhHans: Partial<PdfrxStrings> = {
  toggleSidebar: '切换侧边栏',
  search: '搜索',
  pageNumber: '页码',
  zoomOut: '缩小',
  zoomIn: '放大',
  fitPage: '适合整页',
  fitWidth: '适合宽度',
  print: '打印',
  preparingToPrint: '正在准备页面…',
  searchPlaceholder: '搜索',
  previousMatch: '上一个匹配项 (Shift+Enter)',
  nextMatch: '下一个匹配项 (Enter)',
  clearSearch: '清除搜索 (Esc)',
  clearSearchLabel: '清除搜索',
  closeSearch: '关闭搜索',
  pagesTab: '页面',
  outlineTab: '目录',
  noOutline: '没有目录',
  expand: '展开',
  collapse: '收起',
  goToPage: (n) => `转到第 ${n} 页`,
  copy: '复制',
  selectAll: '全选',
  openFile: '打开 PDF 文件',
  download: '下载',
  closeSidebar: '关闭侧边栏',
  rotatePage: '顺时针旋转 90 度',
  deletePage: '删除此页',
  failedToOpen: (m) => `无法打开文档：${m}`,
};

const zhHant: Partial<PdfrxStrings> = {
  toggleSidebar: '切換側邊欄',
  search: '搜尋',
  pageNumber: '頁碼',
  zoomOut: '縮小',
  zoomIn: '放大',
  fitPage: '符合整頁',
  fitWidth: '符合寬度',
  print: '列印',
  preparingToPrint: '正在準備頁面…',
  searchPlaceholder: '搜尋',
  previousMatch: '上一個符合項目 (Shift+Enter)',
  nextMatch: '下一個符合項目 (Enter)',
  clearSearch: '清除搜尋 (Esc)',
  clearSearchLabel: '清除搜尋',
  closeSearch: '關閉搜尋',
  pagesTab: '頁面',
  outlineTab: '目錄',
  noOutline: '沒有目錄',
  expand: '展開',
  collapse: '收合',
  goToPage: (n) => `前往第 ${n} 頁`,
  copy: '複製',
  selectAll: '全選',
  openFile: '開啟 PDF 檔案',
  download: '下載',
  closeSidebar: '關閉側邊欄',
  rotatePage: '順時針旋轉 90 度',
  deletePage: '刪除此頁',
  failedToOpen: (m) => `無法開啟文件：${m}`,
};

const fr: Partial<PdfrxStrings> = {
  toggleSidebar: 'Afficher/masquer le panneau latéral',
  search: 'Rechercher',
  pageNumber: 'Numéro de page',
  zoomOut: 'Zoom arrière',
  zoomIn: 'Zoom avant',
  fitPage: 'Ajuster à la page',
  fitWidth: 'Ajuster à la largeur',
  print: 'Imprimer',
  preparingToPrint: 'Préparation des pages…',
  searchPlaceholder: 'Rechercher',
  previousMatch: 'Résultat précédent (Maj+Entrée)',
  nextMatch: 'Résultat suivant (Entrée)',
  clearSearch: 'Effacer la recherche (Échap)',
  clearSearchLabel: 'Effacer la recherche',
  closeSearch: 'Fermer la recherche',
  pagesTab: 'Pages',
  outlineTab: 'Sommaire',
  noOutline: 'Aucun sommaire',
  expand: 'Développer',
  collapse: 'Réduire',
  goToPage: (n) => `Aller à la page ${n}`,
  copy: 'Copier',
  selectAll: 'Tout sélectionner',
  openFile: 'Ouvrir un fichier PDF',
  download: 'Télécharger',
  closeSidebar: 'Fermer le panneau latéral',
  rotatePage: 'Pivoter de 90° dans le sens horaire',
  deletePage: 'Supprimer cette page',
  failedToOpen: (m) => `Échec de l'ouverture du document : ${m}`,
};

const de: Partial<PdfrxStrings> = {
  toggleSidebar: 'Seitenleiste umschalten',
  search: 'Suchen',
  pageNumber: 'Seitenzahl',
  zoomOut: 'Verkleinern',
  zoomIn: 'Vergrößern',
  fitPage: 'An Seite anpassen',
  fitWidth: 'An Breite anpassen',
  print: 'Drucken',
  preparingToPrint: 'Seiten werden vorbereitet…',
  searchPlaceholder: 'Suchen',
  previousMatch: 'Vorheriger Treffer (Umschalt+Eingabe)',
  nextMatch: 'Nächster Treffer (Eingabe)',
  clearSearch: 'Suche löschen (Esc)',
  clearSearchLabel: 'Suche löschen',
  closeSearch: 'Suche schließen',
  pagesTab: 'Seiten',
  outlineTab: 'Gliederung',
  noOutline: 'Keine Gliederung',
  expand: 'Erweitern',
  collapse: 'Einklappen',
  goToPage: (n) => `Zu Seite ${n} springen`,
  copy: 'Kopieren',
  selectAll: 'Alles auswählen',
  openFile: 'PDF-Datei öffnen',
  download: 'Herunterladen',
  closeSidebar: 'Seitenleiste schließen',
  rotatePage: 'Um 90° im Uhrzeigersinn drehen',
  deletePage: 'Diese Seite löschen',
  failedToOpen: (m) => `Dokument konnte nicht geöffnet werden: ${m}`,
};

/**
 * Every built-in language as a complete {@link PdfrxStrings}. Each is the
 * translation merged over English, so a key a translation happens to miss still
 * renders in English rather than blank.
 */
export const builtinPdfrxStrings: Record<PdfrxLocale, PdfrxStrings> = {
  en: defaultPdfrxStrings,
  ja: { ...defaultPdfrxStrings, ...ja },
  'zh-Hans': { ...defaultPdfrxStrings, ...zhHans },
  'zh-Hant': { ...defaultPdfrxStrings, ...zhHant },
  fr: { ...defaultPdfrxStrings, ...fr },
  de: { ...defaultPdfrxStrings, ...de },
};

/** Maps one BCP-47 tag to a built-in locale, or `null` when nothing fits. */
function matchLocale(tag: string): PdfrxLocale | null {
  const lower = tag.toLowerCase();
  const [primary, ...subtags] = lower.split('-');
  switch (primary) {
    case 'zh':
      // Script/region decides Simplified vs Traditional; bare `zh` → Simplified.
      return subtags.some((s) => s === 'hant' || s === 'tw' || s === 'hk' || s === 'mo') ? 'zh-Hant' : 'zh-Hans';
    case 'ja':
      return 'ja';
    case 'fr':
      return 'fr';
    case 'de':
      return 'de';
    case 'en':
      return 'en';
    default:
      return null;
  }
}

/** The browser's preferred locales, or `[]` outside a browser (SSR). */
function browserLocales(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages && navigator.languages.length > 0) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

/**
 * Picks the built-in strings that best match the requested locale(s), falling
 * back to English when none is supported.
 *
 * @param requested - One or more BCP-47 tags in priority order (e.g. `'ja'`,
 *   `['fr-CA', 'fr', 'en']`). Pass `undefined` to auto-detect from the browser
 *   (`navigator.languages`).
 */
export function resolvePdfrxStrings(requested: string | readonly string[] | undefined): PdfrxStrings {
  const tags = requested === undefined ? browserLocales() : typeof requested === 'string' ? [requested] : requested;
  for (const tag of tags) {
    const locale = matchLocale(tag);
    if (locale) return builtinPdfrxStrings[locale];
  }
  return builtinPdfrxStrings.en;
}
