// Redirect if already logged in
(function() {
  const token = localStorage.getItem('ragToken');
  if (token) {
    try {
      const p = JSON.parse(atob(token.split('.')[1]));
      if (p.exp > Date.now() / 1000) {
        window.location.href = 'app.html';
      }
    } catch (_) {}
  }
})();

/**
 * Toggles input password visibility between 'password' and 'text'.
 * @param {string} id - Input element ID
 * @param {HTMLButtonElement} btn - Eye button element
 */
function togglePwd(id, btn) {
  const inp = document.getElementById(id);
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = '🙈';
  } else {
    inp.type = 'password';
    btn.textContent = '👁';
  }
}

/**
 * Displays an status/error message in the alert box.
 * @param {string} text - Message text
 * @param {'success'|'error'|'info'} type - Message type class
 */
function showMsg(text, type) {
  const box = document.getElementById('msg-box');
  if (box) {
    box.className = 'msg-box ' + type;
    box.innerHTML = (type === 'error' ? '⚠ ' : '✅ ') + text;
    box.style.display = 'flex';
  }
}

/**
 * Auto-advancing and keyboard navigation setup for 6-digit OTP fields.
 * @param {string} digitClass - CSS class name of the input fields
 * @param {Function} [onComplete] - Callback function triggered when all digits are filled
 * @returns {HTMLInputElement[]} Array of digit input elements
 */
function initOtpInputs(digitClass = 'otp-digit', onComplete) {
  const digits = Array.from(document.querySelectorAll('.' + digitClass));
  if (digits.length === 0) return [];

  digits.forEach((inp, idx) => {
    inp.addEventListener('input', (e) => {
      const val = e.target.value.replace(/\D/g, '');
      inp.value = val ? val[val.length - 1] : '';
      inp.classList.toggle('filled', !!inp.value);
      if (inp.value && idx < digits.length - 1) digits[idx + 1].focus();
      
      const otp = digits.map(d => d.value).join('');
      if (otp.length === digits.length && typeof onComplete === 'function') {
        onComplete(otp);
      }
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!inp.value && idx > 0) {
          digits[idx - 1].value = '';
          digits[idx - 1].classList.remove('filled');
          digits[idx - 1].focus();
        }
      }
      if (e.key === 'ArrowLeft' && idx > 0) digits[idx - 1].focus();
      if (e.key === 'ArrowRight' && idx < digits.length - 1) digits[idx + 1].focus();
    });

    inp.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      pasted.split('').slice(0, digits.length).forEach((ch, i) => {
        if (digits[i]) {
          digits[i].value = ch;
          digits[i].classList.add('filled');
        }
      });
      const nextIdx = Math.min(pasted.length, digits.length - 1);
      digits[nextIdx].focus();
      
      const otp = digits.map(d => d.value).join('');
      if (otp.length === digits.length && typeof onComplete === 'function') {
        onComplete(otp);
      }
    });
  });

  if (digits[0]) digits[0].focus();
  return digits;
}

/**
 * Triggers a countdown timer on a badge element.
 * @param {number} secondsLeft - Total seconds to count down
 * @param {string} badgeId - Badge element ID
 * @param {Function} [onExpire] - Callback function triggered on expiry
 * @returns {number} Interval ID
 */
let activeOtpTimer = null;
function startOtpTimer(secondsLeft, badgeId = 'timer-badge', onExpire) {
  if (activeOtpTimer) clearInterval(activeOtpTimer);
  const badge = document.getElementById(badgeId);
  if (!badge) return null;
  badge.classList.remove('urgent');

  function tick() {
    if (secondsLeft <= 0) {
      badge.textContent = '00:00';
      badge.classList.add('urgent');
      clearInterval(activeOtpTimer);
      if (typeof onExpire === 'function') onExpire();
      return;
    }
    const m = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
    const s = String(secondsLeft % 60).padStart(2, '0');
    badge.textContent = `${m}:${s}`;
    if (secondsLeft <= 60) badge.classList.add('urgent');
    secondsLeft--;
  }

  tick();
  activeOtpTimer = setInterval(tick, 1000);
  return activeOtpTimer;
}

/**
 * Manages resend button cooldown timers.
 * @param {number} seconds - Cooldown duration in seconds
 * @param {string} btnId - Button element ID
 * @param {string} countdownId - Countdown text element ID
 * @returns {number} Interval ID
 */
let activeResendTimer = null;
function startResendCooldown(seconds, btnId = 'resend-btn', countdownId = 'resend-countdown') {
  if (activeResendTimer) clearInterval(activeResendTimer);
  const btn = document.getElementById(btnId);
  const countdown = document.getElementById(countdownId);
  if (!btn) return null;
  
  btn.disabled = true;
  let remaining = seconds;

  function tick() {
    if (remaining <= 0) {
      btn.disabled = false;
      if (countdown) countdown.textContent = '';
      clearInterval(activeResendTimer);
      return;
    }
    if (countdown) countdown.textContent = ` (${remaining}s)`;
    remaining--;
  }

  tick();
  activeResendTimer = setInterval(tick, 1000);
  return activeResendTimer;
}

/**
 * Checks and visualizes password strength.
 * @param {string} val - Password string
 * @param {string} [wrapId='strength-wrap'] - Wrap container ID
 * @param {string} [labelId='s-label'] - Label element ID
 */
function checkStrength(val, wrapId = 'strength-wrap', labelId = 's-label') {
  const wrap = document.getElementById(wrapId);
  const label = document.getElementById(labelId);
  if (!wrap) return;
  
  wrap.style.display = val ? 'block' : 'none';
  if (!val) return;

  let score = 0;
  if (val.length >= 6) score++;
  if (val.length >= 10) score++;
  if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
  if (/[0-9!@#$%^&*]/.test(val)) score++;

  const colors = ['#f87171', '#fb923c', '#fbbf24', '#34d399'];
  const labels = ['Weak', 'Fair', 'Good', 'Strong'];

  for (let i = 1; i <= 4; i++) {
    const bar = document.getElementById('s' + i);
    if (bar) {
      bar.style.background = i <= score ? colors[score - 1] : 'rgba(99,120,180,.15)';
    }
  }

  if (label) {
    label.textContent = labels[score - 1] || '';
    label.style.color = colors[score - 1] || 'transparent';
  }
}

/**
 * Validates if two password fields match.
 * @param {string} [pwdId='password'] - Password input ID
 * @param {string} [confirmId='confirm'] - Confirm password input ID
 * @param {string} [hintId='match-hint'] - Hint element ID
 */
function checkMatch(pwdId = 'password', confirmId = 'confirm', hintId = 'match-hint') {
  const p = document.getElementById(pwdId)?.value || '';
  const c = document.getElementById(confirmId)?.value || '';
  const hint = document.getElementById(hintId);
  if (!hint) return;

  if (!c) {
    hint.textContent = '';
    return;
  }

  if (p === c) {
    hint.textContent = '✓ Passwords match';
    hint.style.color = '#34d399';
  } else {
    hint.textContent = '✗ Passwords do not match';
    hint.style.color = '#f87171';
  }
}

