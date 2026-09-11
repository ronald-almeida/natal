const API_BASE = 'https://api.gatewaypayshark.com.br';

const PRODUCT = Object.freeze({
  name: 'Natal Encantado Rose Decor',
  description: 'Natal Encantado Rose Decor',
  amount: 19700,
  currency: 'BRL',
  type: 'DIGITAL'
});

const UPSELLS = Object.freeze({
  upsell1: { name: 'E-book + de 500 Fotos de Produtos Autorais de Natal Rose Decor', price: 2990, type: 'DIGITAL' },
  upsell2: { name: 'Combo (Lista + Catálogo)', price: 3990, type: 'DIGITAL' },
  upsell3: { name: 'Combo (Escapulários + Guirlandas)', price: 9700, type: 'DIGITAL' }
});

function digits(value = '') { return String(value).replace(/\D/g, ''); }
function validEmail(value = '') { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim()); }
function normalizePhone(value = '') {
  let phone = digits(value);
  if ((phone.length === 12 || phone.length === 13) && phone.startsWith('55')) phone = phone.slice(2);
  return phone;
}
function normalizePayer(input = {}) {
  return {
    name: String(input.name || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    phone: normalizePhone(input.phone),
    taxId: digits(input.taxId)
  };
}
function validatePayer(payer) {
  if (payer.name.length < 3 || !payer.name.includes(' ')) return 'Informe nome e sobrenome.';
  if (!validEmail(payer.email)) return 'Informe um e-mail válido.';
  if (![10, 11].includes(payer.phone.length)) return 'Informe um celular válido com DDD.';
  if (![11, 14].includes(payer.taxId.length)) return 'Informe um CPF/CNPJ válido.';
  return '';
}
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}
function makeExternalRef() {
  return `natal_rose_decor_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      service: 'create-pix',
      product: PRODUCT.name,
      amount: PRODUCT.amount,
      upsells: Object.fromEntries(Object.entries(UPSELLS).map(([key, value]) => [key, value.price])),
      apiKeyConfigured: Boolean(String(process.env.PAYSHARK_API_KEY || '').trim())
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  try {
    const apiKey = String(process.env.PAYSHARK_API_KEY || '').trim();
    if (!apiKey) return res.status(500).json({ success: false, message: 'Configuração de pagamento indisponível.' });

    const body = parseBody(req);
    const payer = normalizePayer(body.payer || body);
    const validationError = validatePayer(payer);
    if (validationError) return res.status(400).json({ success: false, message: validationError });

    const selected = [];
    for (const key of Object.keys(UPSELLS)) {
      if (body.upsells?.[key] === true) selected.push(UPSELLS[key]);
    }

    const amount = PRODUCT.amount + selected.reduce((sum, item) => sum + item.price, 0);
    const items = [
      { quantity: 1, name: PRODUCT.name, price: PRODUCT.amount, type: PRODUCT.type },
      ...selected.map(item => ({ quantity: 1, name: item.name, price: item.price, type: item.type }))
    ];

    const externalRef = makeExternalRef();
    const payload = {
      amount,
      currency: PRODUCT.currency,
      method: 'PIX',
      description: PRODUCT.description,
      externalRef,
      payer: {
        name: payer.name,
        taxId: payer.taxId,
        email: payer.email,
        phone: payer.phone
      },
      items
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let providerResponse;
    try {
      providerResponse = await fetch(`${API_BASE}/v1/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await providerResponse.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { data = { message: raw || 'Resposta inválida do gateway.' }; }

    if (!providerResponse.ok) {
      console.error('Erro PayShark:', providerResponse.status, data);
      return res.status(providerResponse.status >= 500 ? 502 : providerResponse.status).json({
        success: false,
        message: data?.message || data?.errorMessage || 'Não foi possível gerar o Pix.',
        gatewayStatus: providerResponse.status,
        providerCode: data?.code || data?.errorCode || null,
        details: data?.errors || data?.error || data?.details || null
      });
    }

    const pixCode = data?.data?.copypaste;
    if (!pixCode) {
      console.error('Resposta sem data.copypaste:', data);
      return res.status(502).json({ success: false, message: 'O gateway não retornou o código Pix.' });
    }

    return res.status(200).json({
      success: true,
      paymentId: data?.id || null,
      externalRef,
      amount,
      pixCode
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ success: false, message: 'O serviço de pagamento demorou para responder. Tente novamente.' });
    }
    console.error('Erro interno ao criar Pix:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao gerar o Pix. Tente novamente.' });
  }
};
