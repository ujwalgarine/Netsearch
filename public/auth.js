// Sign in and sign up. The server sets the session cookie; this page only sends the form.

const form = document.getElementById('auth-form');
const mode = form.dataset.mode; // 'login' | 'signup'
const submit = document.getElementById('submit');
const formError = document.getElementById('form-error');
const next = new URLSearchParams(location.search).get('next') || '';

if (window.DotField) window.DotField(document.getElementById('auth-field'), { crest: 0.78, rest: 0.06 });

// Carry ?next= across the switch link, so "sign up instead" still lands where the visitor was going.
if (next) {
  const link = document.getElementById('switch-link');
  link.href = `${link.pathname}?next=${encodeURIComponent(next)}`;
}

// Password show/hide.
for (const btn of document.querySelectorAll('.reveal-btn')) {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.getAttribute('aria-controls'));
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.firstElementChild.className = `ph-light ${show ? 'ph-eye-slash' : 'ph-eye'}`;
  });
}

function setFieldError(name, message) {
  const input = form.elements[name];
  const out = document.getElementById(`${name}-error`);
  if (!input || !out) return;
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  out.textContent = message || '';
  out.hidden = !message;
}

function clearErrors() {
  for (const name of ['name', 'email', 'password']) setFieldError(name, '');
  formError.hidden = true;
  formError.replaceChildren();
}

// A top-of-form message, optionally followed by a link (e.g. "Sign in instead").
function showFormError(message, link) {
  formError.replaceChildren(document.createTextNode(`${message} `));
  if (link) {
    const a = document.createElement('a');
    a.href = link.href;
    a.textContent = link.text;
    formError.append(a);
  }
  formError.hidden = false;
}

function validate(values) {
  const errors = {};
  if (mode === 'signup' && !values.name) errors.name = 'Enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = 'Enter a valid email address.';
  if (!values.password) errors.password = 'Enter your password.';
  else if (mode === 'signup' && values.password.length < 10) errors.password = 'Use at least 10 characters.';
  return errors;
}

// Clear a field's error as soon as it's edited.
form.addEventListener('input', (e) => {
  if (e.target.name) setFieldError(e.target.name, '');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();
  const values = {
    name: form.elements.name?.value.trim() ?? '',
    email: form.elements.email.value.trim(),
    password: form.elements.password.value,
  };
  const errors = validate(values);
  if (Object.keys(errors).length) {
    for (const [name, message] of Object.entries(errors)) setFieldError(name, message);
    form.elements[Object.keys(errors)[0]].focus();
    return;
  }

  submit.classList.add('loading');
  submit.setAttribute('aria-busy', 'true');
  try {
    const body = mode === 'signup' ? { ...values, next } : { email: values.email, password: values.password, next };
    const res = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      location.assign(data.redirect || '/app');
      return; // keep the loading state while the app opens
    }
    if (data.fields) {
      for (const [name, message] of Object.entries(data.fields)) setFieldError(name, message);
    }
    if (data.code === 'exists') {
      // "An account with this email already exists. Sign in instead." with the last sentence as the link.
      const [lead, linkText] = data.error.split(/(?<=\.)\s+/);
      showFormError(lead, { href: `/login${next ? `?next=${encodeURIComponent(next)}` : ''}`, text: linkText || 'Sign in instead.' });
    } else if (!data.fields || res.status !== 400) {
      showFormError(data.error || 'Something went wrong. Try again.');
    }
    if (mode === 'login' && res.status === 401) form.elements.password.select();
  } catch {
    showFormError("Couldn't reach the server. Check your connection and try again.");
  }
  submit.classList.remove('loading');
  submit.removeAttribute('aria-busy');
});
