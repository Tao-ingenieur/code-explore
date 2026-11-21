import { english } from './translations'

export type Language = 'zh' | 'en'
const STORAGE_KEY = 'code-explore.language'
function initialLanguage(): Language {
  try { return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh' }
  catch { return 'zh' }
}
let language: Language = initialLanguage()
export function getLanguage(): Language { return language }
export function getLocale(): string { return language === 'en' ? 'en-US' : 'zh-CN' }
export function t(key: string, ...values: unknown[]): string {
  const translated = language === 'en' ? english[key] ?? key : key
  return translated.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ''))
}
export function applyLanguage(): void {
  document.documentElement.lang = getLocale()
  document.title = language === 'en' ? 'Code Explore' : '源码导航'
}
export function setLanguage(next: Language): void {
  language = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch { /* Persistence may be disabled. */ }
  applyLanguage()
}
applyLanguage()
