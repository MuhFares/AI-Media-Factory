/**
 * Standard TTS benchmark scripts (fixed across all providers).
 * These are committed as test fixtures — generated audio is NOT committed.
 */

export const BENCHMARK_SCRIPTS = {
  /** Modern Standard Arabic */
  arabicMsa:
    "اليوم سنستكشف كيف يغيّر الذكاء الاصطناعي طريقة عمل الشركات وتحليل البيانات.",
  /** Egyptian Arabic */
  arabicEgyptian:
    "النهارده هنشوف إزاي الذكاء الاصطناعي بيغير طريقة شغل الشركات وتحليل البيانات.",
  /** Mixed Arabic/English technical */
  mixedArabicEnglish:
    "باستخدام Python وSQL وPower BI، نقدر نبني Data Pipeline ونحوّل البيانات الخام إلى Business Insights.",
  /** English */
  english:
    "Today we are going to explore how artificial intelligence is transforming modern business and data analytics.",
  /** Long-form Arabic technology narration (~45-60s at natural pace) */
  longFormArabic:
    "في هذا الفيديو نستكشف كيف غيّر الذكاء الاصطناعي طريقة إنتاج المحتوى الرقمي. اليوم يمكن لأي فريق صغير أن يحوّل فكرة بسيطة إلى فيديو كامل خلال دقائق، بدلاً من أيام من العمل اليدوي. نبدأ بكتابة السيناريو، ثم نولّد الصورة الرئيسية بالذكاء الاصطناعي، وبعدها نحوّل الصورة إلى فيديو متحرك بنماذج حديثة. وفي النهاية يضاف التعليق الصوتي الآلي ليكمل التجربة. هذه ليست المستقبل، هذا واقع اليوم، والأدوات متاحة للجميع. تابعنا لتتعلم كيف تبني مصنع المحتوى الخاص بك خطوة بخطوة.",
} as const;

export type BenchmarkScriptKey = keyof typeof BENCHMARK_SCRIPTS;
