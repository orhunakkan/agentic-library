import {
  DEFAULT_PREFS,
  FONT_FAMILIES,
  FONT_SIZES,
  LEADING_VALUES,
  MEASURE_VALUES,
  PREFS_KEY,
} from '~/client/features/reader/prefs'

export const SITE_THEME_KEY = 'folio-theme'

export const BOOT_SCRIPT = `(function(){
var d=document.documentElement,D=${JSON.stringify(DEFAULT_PREFS)},L=${JSON.stringify(LEADING_VALUES)},M=${JSON.stringify(MEASURE_VALUES)},F=${JSON.stringify(FONT_SIZES)},R=${JSON.stringify(FONT_FAMILIES)};
function get(s,k){try{return s.getItem(k)}catch(e){return null}}
var site=get(localStorage,${JSON.stringify(SITE_THEME_KEY)});
var dark=site?site==='dark':true;
d.classList.toggle('dark',dark);
var p=null;try{p=JSON.parse(get(localStorage,${JSON.stringify(PREFS_KEY)})||'null')}catch(e){}
if(!p||typeof p!=='object'){p={theme:dark?'dark':'light'}}
var theme=['light','sepia','dark'].indexOf(p.theme)>=0?p.theme:D.theme;
var size=F.indexOf(p.fontSize)>=0?p.fontSize:D.fontSize;
d.setAttribute('data-reader-theme',theme);
d.setAttribute('data-reader-sidebar',p.sidebarHidden===true?'hidden':'shown');
d.setAttribute('data-reader-ask',p.askOpen===true?'open':'closed');
d.setAttribute('data-reader-layout',p.layout==='scroll'?'scroll':'pages');
var font=R.hasOwnProperty(p.font)?p.font:D.font;
d.style.setProperty('--reader-font',R[font]);
d.style.setProperty('--reader-font-size',size+'px');
d.style.setProperty('--reader-leading',String(L[p.leading]||L[D.leading]));
d.style.setProperty('--reader-measure',(M[p.measure]||M[D.measure])+'px');
var q=location.search;
if(/[?&]iframe=true(?:&|$)/.test(q))d.setAttribute('data-embed','on');
if(/[?&]hideTopBar=true(?:&|$)/.test(q)){try{localStorage.setItem('hideTopBar','true')}catch(e){}}
if(get(localStorage,'hideTopBar')==='true')d.setAttribute('data-hide-top-bar','on');
if(get(sessionStorage,'reader-fullscreen')==='on')d.setAttribute('data-reader-fullscreen-pending','on');
addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__folioInstallPrompt=e});
})()`
