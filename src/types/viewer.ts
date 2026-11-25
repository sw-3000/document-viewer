export type ViewMode = 'continuous' | 'single' | 'two-page';

export type ZoomMode = 'fit-width' | 'fit-page' | 'actual-size' | 'custom';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppSettings {
  resumeLastPage: boolean;
  defaultViewMode: ViewMode;
  defaultZoomMode: Exclude<ZoomMode, 'custom'>;
  defaultCoverOffset: boolean;
  theme: ThemePreference;
}

export interface DocumentReadingState {
  docHash: string;
  filePath: string;
  fileName: string;
  totalPages: number;
  pageNumber: number;
  scrollOffsetRatio: number;
  viewMode: ViewMode;
  coverOffset: boolean;
  zoomMode: ZoomMode;
  zoomScale: number;
  updatedAtMs: number;
}

export interface RecentDocumentItem extends DocumentReadingState {
  exists: boolean;
}

export interface FileAssociationStatus {
  isRegisteredInHkcu: boolean;
  currentDefaultProgId: string | null;
  isDefaultPdfViewer: boolean;
}

export interface PdfFileMetadata {
  filePath: string;
  fileName: string;
  fileSize: number;
  docHash: string;
}

export interface PageDimension {
  widthPt: number;
  heightPt: number;
}

export interface OutlineNode {
  id: string;
  title: string;
  destPage: number | null;
  destTopPt: number | null;
  children: OutlineNode[];
}

export interface SearchMatch {
  id: string;
  pageNumber: number;
  matchIndexOnPage: number;
  snippet: string;
  /** Normalized [0..1] highlight boxes relative to unrotated PDF page CSS width/height */
  boxes: Array<{
    leftPct: number;
    topPct: number;
    widthPct: number;
    heightPct: number;
  }>;
}

export interface PdfLinkAnnotation {
  id: string;
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  destPage: number | null;
  destTopPt: number | null;
  url: string | null;
}

export type DocumentLoadStatus =
  | 'loading'
  | 'ready'
  | 'password-required'
  | 'error';

export interface TabSession {
  id: string;
  filePath: string;
  fileName: string;
  docHash: string | null;
  fileSize: number;
  status: DocumentLoadStatus;
  passwordError: string | null;
  errorMessage: string | null;
  totalPages: number;
  currentPage: number;
  scrollOffsetRatio: number;
  viewMode: ViewMode;
  coverOffset: boolean;
  zoomMode: ZoomMode;
  zoomScale: number;
  pageDimensions: PageDimension[];
  outline: OutlineNode[];
  /** Incrementing token to jump/scroll to a target page + optional PDF point Y or page % */
  navigationRequest: {
    seq: number;
    pageNumber: number;
    scrollOffsetRatio?: number;
    topPt?: number | null;
    topPct?: number | null;
  } | null;
}
