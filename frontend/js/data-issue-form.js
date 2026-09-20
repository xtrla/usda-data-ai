(function () {
  'use strict';
  const form = document.getElementById('data-issue-form');
  const open = document.querySelector('.data-issue-open');
  const status = document.getElementById('issue-status');
  const submit = form.querySelector('[type=submit]');
  const cancel = document.getElementById('issue-cancel');
  let submissionId, previousPayload;
  open.addEventListener('click', () => {
    form.hidden = false; open.hidden = true; open.setAttribute('aria-expanded', 'true');
    status.textContent = ''; form.elements.market.focus();
  });
  cancel.addEventListener('click', () => {
    form.hidden = true; open.hidden = false; open.setAttribute('aria-expanded', 'false'); open.focus();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled || !form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    const serialized = JSON.stringify(data);
    if (serialized !== previousPayload) { submissionId = crypto.randomUUID(); previousPayload = serialized; }
    data.submission_id = submissionId;
    submit.disabled = cancel.disabled = true; submit.textContent = 'Sending…';
    status.textContent = ''; status.dataset.error = 'false';
    // Keep the submitted values stable until the server confirms delivery.
    [...form.elements].forEach(el => { el.disabled = true; });
    try {
      const response = await fetch(window.AGRAX_API_BASE.replace(/\/$/, '') + '/data-issues', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data),
        signal: AbortSignal.timeout(30000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) throw new Error(response.status === 404 ? 'This form is not available on the server yet. Your report has not been sent.' : typeof result.detail === 'string' ? result.detail : 'Could not send your report. Please try again.');
      form.reset(); form.hidden = true; open.hidden = false; open.textContent = 'Report another issue';
      open.setAttribute('aria-expanded', 'false'); submissionId = previousPayload = null;
      status.textContent = 'Thank you. Your report has been sent to the AgraX team.'; open.focus();
    } catch (error) {
      status.dataset.error = 'true';
      status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError' ? 'We could not confirm delivery. Check your connection and try again. Your entries have been kept.' : error.message;
    } finally {
      [...form.elements].forEach(el => { el.disabled = false; }); submit.textContent = 'Send report';
    }
  });
})();
