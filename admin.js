(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // Copy-to-clipboard buttons (shipping details for supplier checkout forms)
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (b) {
      const text = b.getAttribute('data-copy');
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      const old = b.textContent; b.textContent = 'Copied ✓'; b.classList.add('copied');
      setTimeout(() => { b.textContent = old; b.classList.remove('copied'); }, 1400);
    }
    const c = e.target.closest('[data-confirm-click]');
    if (c && !window.confirm(c.getAttribute('data-confirm-click'))) e.preventDefault();
  });

  // Confirmation for destructive forms
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.matches('[data-confirm]') && !e.submitter?.hasAttribute('data-confirm-click') && !window.confirm(f.getAttribute('data-confirm'))) { e.preventDefault(); return; }
    const btn = e.submitter; if (btn && !btn.hasAttribute('name')) { setTimeout(() => { btn.disabled = true; }, 0); }
  });

  // Photo slots: click or drag a file onto a slot to preview it before saving
  $$('[data-slot]').forEach((slot) => {
    const input = $('[data-slot-input]', slot); const prev = $('[data-slot-preview]', slot); const clear = $('[data-slot-clear]', slot); const hint = $('.slot-hint', slot);
    const show = () => {
      const f = input.files[0];
      if (!f) { prev.hidden = true; prev.removeAttribute('src'); clear.hidden = true; hint.hidden = false; slot.classList.remove('has-file'); return; }
      if (f.size > 5 * 1024 * 1024) { alert(`${f.name} is larger than 5 MB. Please use a smaller image.`); input.value = ''; return show(); }
      prev.src = URL.createObjectURL(f); prev.hidden = false; clear.hidden = false; hint.hidden = true; slot.classList.add('has-file');
    };
    input.addEventListener('change', show);
    clear.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); input.value = ''; show(); });
    ['dragenter', 'dragover'].forEach((ev) => slot.addEventListener(ev, (e) => { e.preventDefault(); slot.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => slot.addEventListener(ev, () => slot.classList.remove('drag')));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
      if (!f) return;
      const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; show();
    });
  });
  $$('[data-remove-toggle]').forEach((cb) => cb.addEventListener('change', () => cb.closest('.slot').classList.toggle('removing', cb.checked)));

  // Category image preview
  $$('[data-cat-img]').forEach((inp) => inp.addEventListener('change', () => {
    const f = inp.files[0]; if (!f) return;
    const box = inp.closest('.cat-img'); let img = $('img', box);
    if (!img) { img = document.createElement('img'); box.querySelector('span')?.remove(); box.prepend(img); }
    img.src = URL.createObjectURL(f); box.classList.add('has');
  }));

  // Live profit calculator on the product form
  const calcOut = $('[data-calc-out]');
  if (calcOut) {
    const num = (k) => Number(String($(`[data-calc="${k}"]`)?.value || '0').replace(/[$,]/g, '')) || 0;
    const fmt = (n) => (n < 0 ? '−$' : '$') + Math.abs(n).toFixed(2);
    const update = () => {
      const price = num('price'); const cost = num('cost'); const ship = num('ship');
      const profit = price - cost - ship; const margin = price ? Math.round((profit / price) * 100) : 0;
      calcOut.innerHTML = `Profit per unit (before payment fees): <b class="${profit < 0 ? 'neg' : 'pos'}">${fmt(profit)}</b> · margin <b>${margin}%</b>`;
    };
    $$('[data-calc]').forEach((i) => i.addEventListener('input', update)); update();
  }

  // Auto-hide flash
  const flash = $('[data-flash]'); if (flash) setTimeout(() => { flash.style.transition = 'opacity .5s'; flash.style.opacity = '0.0'; setTimeout(() => flash.remove(), 600); }, 6000);
})();
