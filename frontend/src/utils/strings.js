/**
 * Hebrew UI strings — single source of truth for all visible text.
 * Import as: import { S } from '../utils/strings.js';
 */
export const S = {
  // ── Brand ───────────────────────────────────────────────────────────────
  brand: '📖 חוברת דיגיטלית',

  // ── Global nav (BrochureAdmin) ───────────────────────────────────────────
  allBrochures: 'כל החוברות',
  coverBtn:     'כריכה',
  viewBtn:      'צפייה',
  previewBtn:   'תצוגה מקדימה',
  copyLinkBtn:  'העתקת קישור',
  linkCopied:   'הקישור הועתק ✓',
  downloadBtn:  '⬇ הורדה',
  shareBtn:     '📤 שתף',
  shareTitle:   'שיתוף חוברת',
  shareText:    t => `קרא את החוברת: "${t}"`,
  shareWhatsapp: 'שלח ב-WhatsApp',
  shareEmail:    'שלח במייל',
  shareClose:    'סגור',

  // ── Tabs ─────────────────────────────────────────────────────────────────
  tabInfo:      'מידע',
  tabToc:       'תוכן עניינים',
  tabHotspots:  n => `אזורים לחיצים (${n})`,
  tabQr:        n => `קודי QR (${n})`,

  // ── Info tab ─────────────────────────────────────────────────────────────
  brochureInfo: 'פרטי חוברת',
  labelTitle:   'כותרת',
  labelDesc:    'תיאור',
  labelPdf:     'קובץ PDF',
  saveChanges:  'שמור שינויים',
  saving:       'שומר...',
  savedOk:      'נשמר!',

  // ── TOC ──────────────────────────────────────────────────────────────────
  tocTitle:         'תוכן עניינים',
  addTocEntry:      '+ הוסף פריט',
  saveToc:          'שמור תוכן עניינים',
  tocSaved:         'תוכן עניינים נשמר!',
  noTocEntries:     'אין פריטי תוכן עניינים עדיין.',
  sectionPlaceholder: 'כותרת פרק',
  pageLabel:        'עמוד',
  autoSuggestBtn:   '✨ הצע אוטומטית',
  autoSuggestBusy:  '⏳ מנתח...',
  autoSuggestNone:  'לא נמצאו כותרות. נסה להוסיף ידנית.',

  // ── Hotspots tab ─────────────────────────────────────────────────────────
  hotspotsTitle:    'אזורים לחיצים',
  hotspotsDesc:     'בחר עמוד וסמן מלבן כדי ליצור אזור לחיץ.',
  allHotspots:      'כל האזורים',
  noHotspots:       'אין אזורים עדיין.',
  hotspotAdded:     'אזור לחיץ נוסף!',
  hotspotRemoved:   'אזור לחיץ הוסר',
  pageN:            p => `עמוד ${p} — סמן מלבנים להוספת אזורים`,

  // ── Hotspot Editor ───────────────────────────────────────────────────────
  drawHint:         'סמן מלבן על העמוד להוספת אזור לחיץ.',
  pickPageBtn:      'בחר מעמוד',
  pickPageTitle:    'בחר עמוד יעד',
  configHotspot:    'הגדרת אזור לחיץ',
  hotspotLabel:     'תווית',
  hotspotLabelPh:   'תווית לאזור (לדוגמה: "פרק 3")',
  hotspotAction:    'פעולה',
  goToPage:         'מעבר לעמוד',
  openUrl:          'פתח קישור',
  pageNumberPh:     'מספר עמוד',
  urlPh:            'https://...',
  saveHotspot:      'שמור אזור',
  cancelBtn:        'ביטול',
  hotspotToPage:    v => `→ עמוד ${v}`,
  hotspotToUrl:     '🔗 קישור',

  // ── QR Manager ───────────────────────────────────────────────────────────
  qrTitle:          'קודי QR',
  qrScanning:       'סורק PDF לאיתור קודי QR...',
  qrNone:           'לא זוהו קודי QR.',
  qrCount:          n => `${n} קוד${n > 1 ? 'י' : ''} QR זוה${n > 1 ? 'ו' : 'ה'}`,
  scanNow:          '🔍 סרוק QR',
  scanning:         '⏳ סורק...',
  manualAssist:     '✏️ סריקה ידנית',
  qrEmptyMsg:       'לא זוהו קודי QR.',
  qrEmptySub:       'לחץ "סרוק QR" כדי לסרוק את ה-PDF.',

  // ── QR table columns ─────────────────────────────────────────────────────
  colPage:    'עמוד',
  colQr:      'QR',
  colUrl:     'כתובת',
  colActions: 'פעולות',

  // ── QR Row ───────────────────────────────────────────────────────────────
  editQrBtn:        'עריכה',
  deleteQrConfirm:  'להסיר קוד QR זה?',

  // ── QR Edit Modal ────────────────────────────────────────────────────────
  editQrTitle:   p => `עריכת קוד QR — עמוד ${p}`,
  targetUrl:     'כתובת יעד',
  originalLbl:   'מקורי: ',
  saveGenerate:  '✓ שמור וצור תמונת QR',
  generating:    '⏳ יוצר QR...',
  qrNote:        'תמונת QR בגודל 512×512 תיווצר ותוצג כ-overlay בצופה. מצלמת טלפון יכולה לסרוק אותה ישירות מהמסך.',
  previewLbl:    'תצוגה מקדימה',

  // ── ROI Scanner ──────────────────────────────────────────────────────────
  manualQrTitle:   'סיוע QR ידני',
  canvasPx:        (w, h) => `בד: ${w}×${h}px`,
  roiNormLbl:      (x, y, w, h) => `ROI: x=${x} y=${y} w=${w} h=${h}`,
  roiInstructions: 'סמן מלבן סביב הברקוד ולחץ "סרוק אזור נבחר".',
  scanSelected:    '🔍 סרוק אזור נבחר',
  scanningRoi:     '⏳ סורק...',
  clearRoi:        'נקה',
  closeBtn:        '✕ סגור',
  barcodeFound:    'ברקוד נמצא!',
  addedToQrList:   'נוסף לרשימת קודי QR.',
  debugInfo:       (pw, ph, angle, png) =>
    `דיבאג: עמוד ${pw}×${ph}px, נמצא בזווית ${angle ?? 0}° → debug/${png}`,
  barcodeNotFound:     'לא נמצא ברקוד. נסה לסמן אזור גדול יותר.',
  debugNotFound:       (pw, ph, sc, x, y, w, h) =>
    `PNG נשמר לדיבאג | עמוד: ${pw}×${ph}px (scale=${sc}) | crop: x=${x},y=${y} גודל ${w}×${h}px`,

  // ── Preview Modal ────────────────────────────────────────────────────────
  adminPreviewBadge: 'תצוגת אדמין',
  closePreview:      '✕ סגור תצוגה',
  loadingPdf:        'טוען PDF...',
  renderingPage:     p => `מרנדר עמוד ${p}...`,

  // ── Admin (list page) ────────────────────────────────────────────────────
  adminPanel:       'לוח ניהול',
  publicViewBtn:    'תצוגה ציבורית',
  uploadPdf:        '+ העלאת PDF',
  colThumb:         '',
  colTitleTh:       'כותרת',
  colPagesTh:       'עמודים',
  colQrTh:          'קודי QR',
  colHsTh:          'אזורים',
  colSizeTh:        'גודל',
  colCreatedTh:     'נוצר',
  colActionsTh:     'פעולות',
  viewBtnTbl:       'צפייה',
  editBtnTbl:       'עריכה',
  deleteBtnTbl:     'מחיקה',
  noBrochures:      'אין חוברות עדיין',
  uploadFirst:      'העלה PDF כדי להתחיל.',
  confirmDelete:    t => `למחוק "${t}"? לא ניתן לבטל.`,

  // ── Upload Modal ─────────────────────────────────────────────────────────
  uploadTitle:      'העלאת חוברת',
  dropZoneText:     'גרור PDF לכאן או לחץ לבחירת קובץ',
  dropZoneFile:     f => f,
  labelTitleField:  'כותרת',
  labelDescField:   'תיאור (אופציונלי)',
  pdfOnly:          'יש לבחור קובץ PDF.',
  selectPdf:        'יש לבחור PDF.',
  uploadingBtn:     'מעלה...',
  uploadBtn:        'העלה',
  cancelUpload:     'ביטול',

  // ── 404 / Not Found ──────────────────────────────────────────────────────
  pageNotFound:    'הדף לא נמצא',

  // ── Cover page ───────────────────────────────────────────────────────────
  openBrochureBtn: '📖 פתחו את החוברת',
  coverPageCount:  n => `${n} עמודים`,

  // ── Home page ────────────────────────────────────────────────────────────
  homeHeroTitle: 'הספרייה הדיגיטלית שלך',
  homeHeroSub:   'חוברות אינטראקטיביות עם קודי QR וקישורים לחיצים.',
  uploadFirst2:  'העלה את ה-PDF הראשון שלך ←',
  adminBtn:      '⚙️ ניהול',
  openBrochure:  'פתח ←',

  // ── Viewer (classic) ─────────────────────────────────────────────────────
  backToViewer:      '→ חזרה',
  ofPages:           n => `/ ${n}`,
  loadingPdfLong:    'טוען PDF...',
  brochureNotFound:  'חוברת לא נמצאה.',
  brochureNotFoundSub: 'קישור זה אינו תקף, או שהחוברת הוסרה.',
  toggleToc:         'פתח/סגור תוכן עניינים',
  renderingPageDots: p => `מרנדר עמוד ${p}...`,

  // ── Viewer Flip (flipbook) ────────────────────────────────────────────────
  pageOfTotal:       (n, t) => `${n} / ${t}`,
  fullscreenBtn:     'מסך מלא',
  exitFullscreenBtn: 'יצא',
  resetZoomBtn:      '↺',
  tocToggleBtn:      '☰ תוכן עניינים',
  loadingFirstPage:  'טוען חוברת...',

  // ── Theme / Design tab ───────────────────────────────────────────────────
  tabTheme:        'עיצוב',
  themeModeAuto:   'אוטומטי',
  themeModeColor:  'צבעים ידניים',
  themeModeImage:  'תמונת רקע',
  themeReScan:     '🔄 סרוק מחדש',
  themeGenPalette: '✨ צור גוון',
  themeBgLabel:    'רקע',
  themeAccentLabel:'הדגשה',
  themeUpload:     'העלה תמונה',
  themeDim:        'עמעום',
  themeBlur:       'טשטוש',
  themeFit:        'התאמה',
  themeFitCover:   'מלא',
  themeFitContain: 'הכל גלוי',
  themeSave:       'שמור עיצוב',
  themeReset:      'אפס לברירת מחדל',
  themeSaved:      'עיצוב נשמר ✓',
};
