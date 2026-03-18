// @license magnet:?xt=urn:btih:b8999bbaf509c08d127678643c515b9ab0836bae&dn=ISC.txt ISC-License
'use strict';

/* ═══════════════════════════════════════════════════════════════
   NZART EXAM TRAINER — exam.js
   Single-question SPA engine
   ═══════════════════════════════════════════════════════════════ */

/* ── State ──────────────────────────────────────────────────────── */
var slides       = [];     // Array<HTMLFieldSetElement> ordered by data-qi
var current      = 0;      // current flat index
var total        = 0;
var answered     = [];     // bool[] — has user answered this question?
var marked       = [];     // bool[] — marked for review?
var rtGraded     = [];     // bool[] — real-time: has this been graded?

var realTime     = false;
var timeLimit    = false;
var needed       = 0;

var timerEnd     = 0;
var timerHandle  = null;

var rtAnswered   = 0;
var rtCorrect    = 0;

/* ── Palette dots cache ─────────────────────────────────────────── */
var palDots = [];

/* ═══════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', function () {
  /* Read config injected by Flask */
  if (typeof EXAM_CFG !== 'undefined') {
    realTime  = !!EXAM_CFG.realTime;
    timeLimit = !!EXAM_CFG.timeLimit;
    needed    = EXAM_CFG.needed || 0;
    total     = EXAM_CFG.total  || 0;
  }

  /* Collect slides sorted by data-qi */
  var allSlides = document.querySelectorAll('.q-slide');
  slides = Array.prototype.slice.call(allSlides).sort(function (a, b) {
    return parseInt(a.getAttribute('data-qi'), 10) - parseInt(b.getAttribute('data-qi'), 10);
  });
  total = slides.length;

  /* Init state arrays */
  answered  = new Array(total).fill(false);
  marked    = new Array(total).fill(false);
  rtGraded  = new Array(total).fill(false);

  /* Show .jsonly elements */
  document.querySelectorAll('.jsonly').forEach(function (el) {
    el.style.removeProperty('display');
    el.classList.remove('jsonly');
  });

  /* Wire radio inputs */
  slides.forEach(function (slide, qi) {
    var inputs = slide.querySelectorAll('input[type="radio"]');
    inputs.forEach(function (inp) {
      inp.addEventListener('click', function () { onAnswer(qi, inp); });
    });
  });

  /* Build palette */
  buildPalette();

  /* Show first question */
  showQuestion(0, null);

  /* Timer */
  if (timeLimit) {
    timerEnd = Date.now() + 2 * 60 * 60 * 1000;
    document.getElementById('hdr-timer').classList.remove('t-hidden');
    document.getElementById('hdr-timer').textContent = '2:00:00';
    timerHandle = setInterval(tick, 1000);
  }

  /* Font toggle in exam header */
  var fb = document.getElementById('btn-font-exam');
  if (fb) {
    if (localStorage.getItem('nz-font')) document.body.classList.add('font-lg');
    fb.setAttribute('aria-pressed', document.body.classList.contains('font-lg') ? 'true' : 'false');
    fb.addEventListener('click', function () {
      var on = document.body.classList.toggle('font-lg');
      fb.setAttribute('aria-pressed', on ? 'true' : 'false');
      localStorage.setItem('nz-font', on ? '1' : '');
    });
  }

  /* Theme toggle — light/dark */
  var tb = document.getElementById('btn-theme-exam');
  if (tb) {
    /* Apply stored preference now (body exists, class is safe to set) */
    var isLight = !!localStorage.getItem('nz-exam-light');
    document.body.classList.toggle('exam-light', isLight);
    document.documentElement.setAttribute('data-exam-light', isLight ? '1' : '');
    tb.setAttribute('aria-pressed', isLight ? 'true' : 'false');
    tb.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';

    tb.addEventListener('click', function () {
      var nowLight = document.body.classList.toggle('exam-light');
      document.documentElement.setAttribute('data-exam-light', nowLight ? '1' : '');
      localStorage.setItem('nz-exam-light', nowLight ? '1' : '');
      tb.setAttribute('aria-pressed', nowLight ? 'true' : 'false');
      tb.title = nowLight ? 'Switch to dark mode' : 'Switch to light mode';
      toast(nowLight ? '☀ Light mode' : '◑ Dark mode');
    });
  }

  /* Button wiring */
  var btnPrev   = document.getElementById('btn-prev');
  var btnNext   = document.getElementById('btn-next');
  var btnMark   = document.getElementById('btn-mark');
  var btnSubmit = document.getElementById('btn-submit');
  var btnKbd    = document.getElementById('btn-kbd');

  if (btnPrev)   btnPrev.addEventListener('click',   function () { navigate(-1); });
  if (btnNext)   btnNext.addEventListener('click',   function () { navigate(1);  });
  if (btnMark)   btnMark.addEventListener('click',   function () { toggleMark(current); });
  if (btnSubmit) btnSubmit.addEventListener('click', openSubmitModal);
  if (btnKbd)    btnKbd.addEventListener('click',    toggleKbd);

  /* Modal wiring */
  document.getElementById('modal-cancel') .addEventListener('click', closeSubmitModal);
  document.getElementById('modal-confirm').addEventListener('click', confirmSubmit);
  document.getElementById('timeout-ok')   .addEventListener('click', function () {
    closeModal('timeout-modal');
    doSubmit();
  });

  /* Backdrop close */
  document.getElementById('submit-modal').addEventListener('click', function (e) {
    if (e.target === this) closeSubmitModal();
  });

  /* Keyboard */
  setupKeyboard();

  /* beforeunload guard */
  window.onbeforeunload = function () {
    if (answered.some(Boolean)) return 'Leave and lose your exam progress?';
  };
});

/* ═══════════════════════════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════════════════════════ */
function navigate(dir) {
  var next = current + dir;
  if (next < 0 || next >= total) return;
  showQuestion(next, dir > 0 ? 'left' : 'right');
}

function showQuestion(qi, exitDir) {
  var prev = current;

  /* Exit animation on old slide */
  if (prev !== qi && slides[prev]) {
    var exitClass = (exitDir === 'left') ? 'q-exit-left' : 'q-exit-right';
    slides[prev].classList.remove('q-active');
    slides[prev].classList.add(exitClass);
    /* Remove exit class after transition */
    (function (el, cls) {
      setTimeout(function () { el.classList.remove(cls); }, 220);
    })(slides[prev], exitClass);
  }

  current = qi;

  /* Enter new slide */
  if (slides[qi]) {
    slides[qi].classList.add('q-active');
    /* Scroll palette dot into view */
    scrollPaletteTo(qi);
  }

  updateHeader();
  updateNav();
  updatePalette();
}

/* ═══════════════════════════════════════════════════════════════
   ANSWER HANDLING
   ═══════════════════════════════════════════════════════════════ */
function onAnswer(qi, input) {
  if (rtGraded[qi]) return; /* already graded — locked */

  var wasAnswered = answered[qi];
  answered[qi] = true;

  updatePaletteOne(qi);
  updateNav();

  if (!realTime) {
    if (!wasAnswered) toast('Answer saved');
    return;
  }

  /* Real-time grading */
  if (rtGraded[qi]) return;
  rtGraded[qi] = true;

  var formName   = parseInt(slides[qi].getAttribute('data-form-name'), 10);
  var userAnswer = parseInt(input.value, 10);
  var correct    = (Answers[formName] === userAnswer);

  /* Grade visuals */
  var choiceEls = slides[qi].querySelectorAll('.choice');
  choiceEls.forEach(function (ch) {
    var inp = ch.querySelector('input[type="radio"]');
    inp.disabled = true;
    var optVal = parseInt(inp.value, 10);
    if (optVal === Answers[formName]) {
      ch.classList.add('rt-correct');
    } else if (optVal === userAnswer && !correct) {
      ch.classList.add('rt-wrong');
    }
  });

  slides[qi].classList.add('rt-done');

  /* Feedback strip */
  var fb = document.getElementById('fb' + formName);
  if (fb) {
    fb.textContent = correct ? '✓  Correct' : '✕  Incorrect';
    fb.className   = 'rt-feedback show ' + (correct ? 'fb-correct' : 'fb-wrong');
  }

  if (correct) { rtCorrect++; }
  rtAnswered++;

  updatePaletteOne(qi);

  /* Unlock radios for POST (we need the value to be submitted) */
  /* They're disabled visually but we need values in the POST.
     Re-enable on submit via BeforePOST. */

  /* Check auto-submit */
  if (rtAnswered >= total) {
    window.onbeforeunload = null;
    setTimeout(function () {
      beforPOST();
      document.getElementById('exam-form').submit();
    }, 1200);
    return;
  }

  /* Auto-advance after brief feedback */
  setTimeout(function () {
    if (current === qi && qi < total - 1) {
      showQuestion(qi + 1, 'left');
    }
  }, 1400);
}

/* ═══════════════════════════════════════════════════════════════
   MARK FOR REVIEW
   ═══════════════════════════════════════════════════════════════ */
function toggleMark(qi) {
  marked[qi] = !marked[qi];
  slides[qi].classList.toggle('q-marked', marked[qi]);

  var btn = document.getElementById('btn-mark');
  if (btn) {
    btn.textContent = marked[qi] ? '★' : '☆';
    btn.classList.toggle('marked', marked[qi]);
    btn.setAttribute('aria-pressed', marked[qi] ? 'true' : 'false');
  }

  updatePaletteOne(qi);
  toast(marked[qi] ? '★ Flagged for review' : '☆ Flag removed');
}

/* ═══════════════════════════════════════════════════════════════
   HEADER UPDATES
   ═══════════════════════════════════════════════════════════════ */
function updateHeader() {
  var qi = current;

  /* Section name */
  var section = document.getElementById('hdr-section');
  if (section && slides[qi]) {
    section.textContent = slides[qi].getAttribute('data-block') || '';
  }

  /* Progress bar */
  var fill  = document.getElementById('hdr-progress-fill');
  var wrap  = document.getElementById('hdr-progress-bar');
  var pct   = Math.round(((qi + 1) / total) * 100);
  if (fill) fill.style.width = pct + '%';
  if (wrap) wrap.setAttribute('aria-valuenow', pct);

  /* Count */
  var count = document.getElementById('hdr-count');
  if (count) count.textContent = (qi + 1) + ' / ' + total;
}

function updateNav() {
  var btnPrev = document.getElementById('btn-prev');
  var btnNext = document.getElementById('btn-next');
  var btnMark = document.getElementById('btn-mark');

  if (btnPrev) btnPrev.disabled = (current === 0);
  if (btnNext) btnNext.disabled = (current === total - 1);

  /* Mark button state */
  if (btnMark) {
    var isMarked = marked[current];
    btnMark.textContent = isMarked ? '★' : '☆';
    btnMark.classList.toggle('marked', isMarked);
    btnMark.setAttribute('aria-pressed', isMarked ? 'true' : 'false');
  }
}

/* ═══════════════════════════════════════════════════════════════
   PALETTE
   ═══════════════════════════════════════════════════════════════ */
function buildPalette() {
  var strip = document.getElementById('palette-strip');
  if (!strip) return;

  strip.innerHTML = '';
  palDots = [];

  for (var i = 0; i < total; i++) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pal-dot';
    btn.textContent = String(i + 1).padStart(2, '0');
    btn.setAttribute('aria-label', 'Go to question ' + (i + 1));
    btn.setAttribute('role', 'listitem');
    btn.setAttribute('data-qi', i);

    (function (idx) {
      btn.addEventListener('click', function () {
        showQuestion(idx, idx > current ? 'left' : 'right');
      });
    })(i);

    strip.appendChild(btn);
    palDots.push(btn);
  }
}

function updatePalette() {
  for (var i = 0; i < palDots.length; i++) {
    updatePaletteOne(i);
  }
}

function updatePaletteOne(qi) {
  var dot = palDots[qi];
  if (!dot) return;

  dot.classList.remove('pd-current','pd-answered','pd-marked','pd-correct','pd-wrong');

  if (qi === current) {
    dot.classList.add('pd-current');
    return;
  }

  if (realTime && rtGraded[qi]) {
    var formName = parseInt(slides[qi].getAttribute('data-form-name'), 10);
    var checked  = slides[qi].querySelector('input[type="radio"]:checked');
    if (checked) {
      var isCorrect = (parseInt(checked.value, 10) === Answers[formName]);
      dot.classList.add(isCorrect ? 'pd-correct' : 'pd-wrong');
    }
    return;
  }

  if (marked[qi])   { dot.classList.add('pd-marked');   return; }
  if (answered[qi]) { dot.classList.add('pd-answered'); return; }
}

function scrollPaletteTo(qi) {
  var dot = palDots[qi];
  if (!dot) return;
  dot.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

/* ═══════════════════════════════════════════════════════════════
   TIMER
   ═══════════════════════════════════════════════════════════════ */
function tick() {
  var diff = timerEnd - Date.now();
  var el   = document.getElementById('hdr-timer');

  if (diff <= 0) {
    clearInterval(timerHandle);
    if (el) el.textContent = "Time's up";
    window.onbeforeunload = null;
    openModal('timeout-modal');
    return;
  }

  var s   = Math.ceil(diff / 1000);
  var h   = Math.floor(s / 3600);
  var m   = Math.floor((s % 3600) / 60);
  var sec = s % 60;

  var timeStr = (h ? h + ':' : '') +
    String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');

  if (el) {
    el.textContent = timeStr;
    el.classList.remove('t-warn', 't-danger');
    if      (diff < 60000)  el.classList.add('t-danger');
    else if (diff < 600000) el.classList.add('t-warn');
  }

  /* Warnings */
  if (diff < 600500 && diff > 599500) toast('10 minutes remaining', '⏱');
  if (diff < 300500 && diff > 299500) toast('5 minutes remaining!', '⚠');
  if (diff <  60500 && diff >  59500) toast('1 minute remaining!',  '🚨');
}

/* ═══════════════════════════════════════════════════════════════
   SUBMIT FLOW
   ═══════════════════════════════════════════════════════════════ */
function openSubmitModal() {
  var ans     = answered.filter(Boolean).length;
  var skipped = total - ans;
  var flagged = marked.filter(Boolean).length;

  document.getElementById('ms-answered').textContent = ans;
  document.getElementById('ms-skipped') .textContent = skipped;
  document.getElementById('ms-marked')  .textContent = flagged;

  openModal('submit-modal');
  document.getElementById('modal-cancel').focus();
}

function closeSubmitModal() { closeModal('submit-modal'); }

function confirmSubmit() {
  closeSubmitModal();
  doSubmit();
}

function doSubmit() {
  clearInterval(timerHandle);
  window.onbeforeunload = null;
  beforPOST();
  document.getElementById('exam-form').submit();
}

/* Re-enable all radios so checked values are included in POST */
function beforPOST() {
  var inputs = document.getElementsByTagName('input');
  for (var i = 0; i < inputs.length; i++) {
    if (inputs[i].type === 'radio') {
      inputs[i].disabled = false;
      /* Prevent further interaction */
      inputs[i].onclick = function () { return false; };
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   KEYBOARD NAVIGATION
   ═══════════════════════════════════════════════════════════════ */
function setupKeyboard() {
  document.addEventListener('keydown', function (e) {
    var el  = document.activeElement;
    var tag = el ? el.tagName : '';

    /*
     * Only surrender control to the browser for genuine text-entry fields.
     * Radio buttons are NOT text inputs — we intercept all keys from them
     * so native arrow-key cycling between radio options never fires.
     */
    var isTextInput = tag === 'TEXTAREA' ||
                      tag === 'SELECT'   ||
                      (tag === 'INPUT' && el.type !== 'radio' && el.type !== 'checkbox');

    var modalOpen = document.querySelector('.modal-veil.open');

    /* Escape always works regardless of focus */
    if (e.key === 'Escape') {
      if (modalOpen) { closeSubmitModal(); return; }
      var kp = document.getElementById('kbd-panel');
      if (kp && kp.classList.contains('open')) { kp.classList.remove('open'); return; }
    }

    if (modalOpen) return;

    /* Let the browser handle typing in real text fields */
    if (isTextInput) return;

    /*
     * From here every key is intercepted — including when a radio is focused.
     * e.preventDefault() on arrow keys stops the browser from cycling
     * the selected radio option, which is the native behaviour we are replacing.
     */
    switch (e.key) {

      /* Question navigation */
      case 'ArrowRight': case 'ArrowDown':
        e.preventDefault(); navigate(1); break;

      case 'ArrowLeft': case 'ArrowUp':
        e.preventDefault(); navigate(-1); break;

      case 'j': case 'J':
        e.preventDefault(); navigate(1); break;

      case 'k': case 'K':
        e.preventDefault(); navigate(-1); break;

      /* Option selection — works whether or not a radio is focused */
      case '1': case '2': case '3': case '4':
        e.preventDefault();
        selectOption(current, parseInt(e.key, 10) - 1);
        break;

      /* Mark for review */
      case 'm': case 'M':
        e.preventDefault(); toggleMark(current); break;

      /* Clear answer */
      case 'Delete':
        e.preventDefault(); clearCurrentAnswer(); break;

      /* Submit */
      case 'Enter':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); openSubmitModal(); }
        break;

      /* Shortcuts panel */
      case '?':
        e.preventDefault(); toggleKbd(); break;
    }
  });
}

function selectOption(qi, optIdx) {
  var slide  = slides[qi];
  if (!slide) return;
  if (rtGraded[qi]) return; /* locked */

  var inputs = slide.querySelectorAll('input[type="radio"]');
  if (!inputs[optIdx]) return;

  inputs[optIdx].checked = true;
  inputs[optIdx].dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function clearCurrentAnswer() {
  var slide = slides[current];
  if (!slide) return;
  if (rtGraded[current]) { toast('Answer locked in real-time mode'); return; }

  var inputs = slide.querySelectorAll('input[type="radio"]');
  inputs.forEach(function (inp) { inp.checked = false; });
  answered[current] = false;
  updatePaletteOne(current);
  toast('Answer cleared');
}

/* ═══════════════════════════════════════════════════════════════
   MODAL HELPERS
   ═══════════════════════════════════════════════════════════════ */
function openModal(id) {
  var el = document.getElementById(id);
  if (el) {
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(id) {
  var el = document.getElementById(id);
  if (el) {
    el.classList.remove('open');
    document.body.style.overflow = '';
  }
}

/* ═══════════════════════════════════════════════════════════════
   KEYBOARD PANEL
   ═══════════════════════════════════════════════════════════════ */
function toggleKbd() {
  var panel = document.getElementById('kbd-panel');
  if (panel) panel.classList.toggle('open');
}

/* ═══════════════════════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════════════════════ */
function toast(msg, icon) {
  var area = document.getElementById('toast-area');
  if (!area) return;
  var el   = document.createElement('div');
  el.className = 'toast';
  el.textContent = (icon ? icon + ' ' : '') + msg;
  area.appendChild(el);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
}

/* ═══════════════════════════════════════════════════════════════
   ANSWER KEY  (do not scroll — spoilers below)
   ═══════════════════════════════════════════════════════════════ */
var Answers =
[2,2,1,2,0,0,3,0,0,3,1,2,0,0,1,0,3,3,2,1,3,2,2,2,1,1,3,2,3,0,3,0,2,3,1,2,0,1,3,0,2,1,3,0,1,3,1,1,1,2,1,0,3,3,0,0,2,1,2,3,2,1,2,1,0,2,3,1,2,1,3,1,1,2,3,2,3,1,0,3,2,0,0,1,0,0,1,3,2,2,3,2,2,0,1,1,0,0,2,1,0,3,2,0,1,3,1,3,2,3,3,3,2,3,0,0,1,2,1,2,2,0,1,0,1,3,3,0,1,1,0,1,3,3,0,3,3,3,3,0,0,3,1,2,2,0,3,0,2,0,0,1,3,2,0,3,3,1,0,2,2,0,3,2,0,1,1,3,2,0,2,0,1,2,1,3,0,0,3,1,1,0,1,0,3,2,1,3,2,0,0,1,3,1,3,2,2,3,3,1,0,0,3,0,0,0,3,1,0,1,1,2,0,0,1,1,0,2,1,1,3,1,0,1,0,1,0,1,2,1,1,3,0,2,3,0,2,3,1,2,2,3,1,1,2,1,1,1,0,3,2,1,0,3,2,3,0,3,2,1,0,1,2,2,1,3,0,2,0,2,2,1,2,0,1,1,0,2,1,1,1,3,0,2,0,3,0,1,0,2,2,0,2,1,3,3,1,2,1,2,0,1,0,1,1,0,3,1,1,3,0,2,1,2,2,3,2,3,3,3,0,0,3,2,1,1,2,1,1,1,2,0,0,3,1,2,0,2,2,1,2,1,2,2,1,3,0,2,1,0,0,3,1,2,3,0,1,2,2,1,0,2,2,3,0,0,3,1,0,2,1,2,3,3,1,2,3,1,2,0,3,1,1,0,0,1,3,2,1,2,1,3,0,0,3,3,1,1,2,3,1,3,2,0,2,3,0,2,2,3,0,1,0,1,1,3,0,1,0,1,1,2,2,0,0,3,2,0,3,1,2,0,1,2,3,0,1,2,3,0,2,1,3,3,0,1,0,1,0,1,2,2,3,1,1,2,2,3,2,0,0,0,2,3,0,0,2,0,3,3,0,1,2,2,3,0,2,3,2,1,1,2,1,3,0,1,3,3,3,0,0,1,0,0,1,0,2,1,1,1,2,1,1,2,1,2,3,3,1,0,1,2,1,3,3,0,2,2,1,2,0,0,2,2,3,0,3,1,3,3,3,3,3,0,2,1,0,3,1,1,1,1,0,2,2,2,3,3,3,1,0,3,1,0,2,2,1,2,0,1,1,0,0,3,1,2,1,1,3,0,0,1,3,1,2,1,2,0,0,3,1,2,2,2,3,1,0,0,2,3,0,2,3,3,2,0,1,1,0,2];

// @license-end