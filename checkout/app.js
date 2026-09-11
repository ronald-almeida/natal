const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const PRODUCT_AMOUNT = 19700;
const UPSELL_PRICES = { upsell1: 2990, upsell2: 3990, upsell3: 9700 };
let pixCode = '';
let timerInterval = null;

function money(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function digits(value) { return String(value || '').replace(/\D/g, ''); }

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function formatPhone(value) {
  const d = digits(value).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function formatTaxId(value) {
  const d = digits(value).slice(0, 14);
  if (d.length <= 11) {
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function selectedUpsells() {
  const result = {};
  $$('[data-upsell]').forEach((input) => { result[input.dataset.upsell] = input.checked; });
  return result;
}

function currentTotal() {
  return PRODUCT_AMOUNT + Object.entries(selectedUpsells()).reduce((sum, [key, checked]) => sum + (checked ? UPSELL_PRICES[key] : 0), 0);
}

function updateTotal() {
  const total = money(currentTotal());
  $('#total').textContent = total;
  $('#modalTotal').textContent = total;
}

function showModal() {
  $('#pixModal').classList.remove('hidden');
  $('#pixModal').setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeModal() {
  $('#pixModal').classList.add('hidden');
  $('#pixModal').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

function startTimer() {
  clearInterval(timerInterval);
  let remaining = 15 * 60;
  const render = () => {
    const min = String(Math.floor(remaining / 60)).padStart(2, '0');
    const sec = String(remaining % 60).padStart(2, '0');
    $('#pixTimer').textContent = `${min}:${sec}`;
  };
  render();
  timerInterval = setInterval(() => {
    remaining -= 1;
    render();
    if (remaining <= 0) {
      clearInterval(timerInterval);
      $('#copyPix').disabled = true;
      $('#copyStatus').textContent = 'Este código expirou. Gere um novo Pix.';
    }
  }, 1000);
}

async function generatePix() {
  const button = $('#payButton');
  const name = $('#name').value.trim();
  const email = $('#email').value.trim();
  const phone = digits($('#phone').value);
  const taxId = digits($('#taxId').value);

  if (name.length < 3 || !name.includes(' ')) return alert('Informe nome e sobrenome.');
  if (!validEmail(email)) return alert('Informe um e-mail válido.');
  if (![10, 11].includes(phone.length)) return alert('Informe um celular válido com DDD.');
  if (![11, 14].includes(taxId.length)) return alert('Informe um CPF/CNPJ válido.');

  button.disabled = true;
  button.textContent = 'Gerando Pix...';

  try {
    const response = await fetch('/api/create-pix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ payer: { name, email, phone, taxId }, upsells: selectedUpsells() })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      const detail = data.details ? ` ${typeof data.details === 'string' ? data.details : JSON.stringify(data.details)}` : '';
      throw new Error(`${data.message || 'Não foi possível gerar o Pix.'}${data.gatewayStatus ? ` (gateway ${data.gatewayStatus})` : ''}${detail}`);
    }

    pixCode = data.pixCode;
    $('#qrImage').src = data.qrCodeDataUrl || '';
    $('#qrImage').classList.toggle('hidden', !data.qrCodeDataUrl);
    $('#copyPix').disabled = false;
    $('#copyStatus').textContent = '';
    showModal();
    startTimer();
  } catch (error) {
    alert(error.message || 'Não foi possível gerar o Pix.');
  } finally {
    button.disabled = false;
    button.textContent = 'Pagar';
  }
}

async function copyPix() {
  if (!pixCode) return;
  try {
    await navigator.clipboard.writeText(pixCode);
    $('#copyStatus').textContent = 'Código Pix copiado.';
  } catch {
    const area = document.createElement('textarea');
    area.value = pixCode;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    $('#copyStatus').textContent = 'Código Pix copiado.';
  }
}

$('#phone').addEventListener('input', (event) => { event.target.value = formatPhone(event.target.value); });
$('#taxId').addEventListener('input', (event) => { event.target.value = formatTaxId(event.target.value); });
$$('[data-upsell]').forEach((input) => input.addEventListener('change', updateTotal));
$('#payButton').addEventListener('click', generatePix);
$('#copyPix').addEventListener('click', copyPix);
$$('[data-close-modal]').forEach((element) => element.addEventListener('click', closeModal));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });
updateTotal();
