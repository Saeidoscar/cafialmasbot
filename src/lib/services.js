// ─────────────────────────────────────────────
// src/lib/services.js — کاتالوگ جامع خدمات کافه‌نت و درگاه‌های دولتی
// ─────────────────────────────────────────────

export const SERVICE_CATEGORIES = {
  JUDICIAL: {
    code: 'JUDICIAL',
    title: '⚖️ خدمات قضایی و هویت دیجیتال',
    desc: 'ثبت‌نام ثنا، ابلاغ الکترونیک و گواهی امضای دیجیتال گیکا',
  },
  GOVERNMENT: {
    code: 'GOVERNMENT',
    title: '🏛 دولت الکترونیک و مالیات',
    desc: 'پنجره ملی خدمات دولت هوشمند و پرونده‌های مالیاتی',
  },
  INSURANCE_BIZ: {
    code: 'INSURANCE_BIZ',
    title: '🏥 بیمه، تامین اجتماعی و مجوز کسب',
    desc: 'سوابق و خدمات بیمه تامین اجتماعی و درگاه ملی مجوزها',
  },
  HOUSING_BANK: {
    code: 'HOUSING_BANK',
    title: '🏠 مسکن، املاک و تسهیلات بانکی',
    desc: 'سامانه املاک و اسکان، قرارداد خودنویس و وام سامان',
  },
};

export const SERVICES_CATALOG = {
  SANA: {
    code: 'SANA',
    command: '/sana',
    nameFa: 'سامانه ثنا / سانا',
    nameEn: 'SANA Judicial Portal',
    category: 'JUDICIAL',
    icon: '⚖️',
    portalUrl: 'https://sana.ir',
    description: 'ثبت‌نام، بازیابی رمز، مشاهده ابلاغیه و خدمات الکترونیک قضایی',
    requiredFields: ['national_id', 'birth_date', 'mobile_number', 'serial_number'],
    priceToman: 85000,
    estimatedMinutes: 15,
  },
  GICA: {
    code: 'GICA',
    command: '/gica',
    nameFa: 'گواهی امضای الکترونیکی گیکا',
    nameEn: 'GICA Digital Certificate',
    category: 'JUDICIAL',
    icon: '🔏',
    portalUrl: 'https://gica.ir',
    description: 'ثبت درخواست و صدور توکن گواهی امضای الکترونیکی مرکز دولتی صدور گواهی',
    requiredFields: ['national_id', 'birth_date', 'mobile_number', 'tracking_code'],
    priceToman: 120000,
    estimatedMinutes: 20,
  },
  MYGOV: {
    code: 'MYGOV',
    command: '/mygov',
    nameFa: 'پنجره ملی خدمات دولت (my.gov.ir)',
    nameEn: 'MyGov Smart Portal',
    category: 'GOVERNMENT',
    icon: '🔐',
    portalUrl: 'https://my.gov.ir',
    description: 'احراز هویت یکپارچه، استعلام‌های دولتی و کارپوشه ملی ایرانیان',
    requiredFields: ['phone_number', 'national_id', 'birth_date', 'birth_place'],
    priceToman: 60000,
    estimatedMinutes: 10,
  },
  TAX: {
    code: 'TAX',
    command: '/tax',
    nameFa: 'امور مالیاتی (my.tax.gov.ir)',
    nameEn: 'National Tax Portal',
    category: 'GOVERNMENT',
    icon: '💰',
    portalUrl: 'https://my.tax.gov.ir',
    description: 'تشکیل پرونده مالیاتی، کد اقتصادی، اظهارنامه و مفاصاحساب مالیاتی',
    requiredFields: ['national_id', 'birth_date', 'mygov_token', 'tax_id'],
    priceToman: 180000,
    estimatedMinutes: 30,
  },
  INSURANCE: {
    code: 'INSURANCE',
    command: '/insurance',
    nameFa: 'بیمه تامین اجتماعی (eservice.tamin.ir)',
    nameEn: 'Tamin Social Security Insurance',
    category: 'INSURANCE_BIZ',
    icon: '🏥',
    portalUrl: 'https://eservice.tamin.ir',
    description: 'مشاهده سوابق بیمه، فیش حق بیمه، بیمه خویش‌فرما و بیمه تکمیلی',
    requiredFields: ['national_id', 'birth_date', 'insurance_number', 'insurance_type'],
    priceToman: 95000,
    estimatedMinutes: 15,
  },
  MOJAVEZ: {
    code: 'MOJAVEZ',
    command: '/mojavez',
    nameFa: 'درگاه ملی مجوزها (mojavez.ir)',
    nameEn: 'National Business Licenses',
    category: 'INSURANCE_BIZ',
    icon: '📄',
    portalUrl: 'https://mojavez.ir',
    description: 'ثبت درخواست پروانه کسب، مجوزهای صنفی و خانگی و پیگیری صدور',
    requiredFields: ['national_id', 'birth_date', 'business_type', 'business_address'],
    priceToman: 150000,
    estimatedMinutes: 25,
  },
  AMLAK: {
    code: 'AMLAK',
    command: '/amlak',
    nameFa: 'املاک و اسکان (amlak.mrud.ir)',
    nameEn: 'National Real Estate & Residence',
    category: 'HOUSING_BANK',
    icon: '🏠',
    portalUrl: 'https://amlak.mrud.ir',
    description: 'خوداظهاری املاک و اسکان، تایید کد پستی جهت خدمات بانکی و تعویض پلاک',
    requiredFields: ['national_id', 'birth_date', 'address', 'post_code'],
    priceToman: 110000,
    estimatedMinutes: 20,
  },
  KHODNEWIS: {
    code: 'KHODNEWIS',
    command: '/khodnevis',
    nameFa: 'قرارداد خودنویس (khodnevis.mrud.ir)',
    nameEn: 'Khodnevis Real Estate Contracts',
    category: 'HOUSING_BANK',
    icon: '✍️',
    portalUrl: 'https://khodnevis.mrud.ir',
    description: 'ثبت رسمی قرارداد اجاره و خرید و فروش مسکن و دریافت کد رهگیری رایگان',
    requiredFields: ['national_id', 'birth_date', 'contract_type'],
    priceToman: 220000,
    estimatedMinutes: 30,
  },
  SAMAN: {
    code: 'SAMAN',
    command: '/saman',
    nameFa: 'تسهیلات و مسکن سامان (saman.mrud.ir)',
    nameEn: 'Saman Housing & Loans',
    category: 'HOUSING_BANK',
    icon: '🏦',
    portalUrl: 'https://saman.mrud.ir',
    description: 'ثبت‌نام وام ودیعه مسکن، نهضت ملی مسکن و تسهیلات بانکی وزارت راه',
    requiredFields: ['national_id', 'birth_date', 'loan_amount', 'loan_type'],
    priceToman: 160000,
    estimatedMinutes: 25,
  },
};

export const ALL_SERVICE_CODES = Object.keys(SERVICES_CATALOG);

export const TASK_NAME_FA = Object.fromEntries(
  Object.entries(SERVICES_CATALOG).map(([k, v]) => [k, v.nameFa])
);

export function getServiceInfo(code) {
  return SERVICES_CATALOG[String(code ?? '').toUpperCase()] ?? null;
}

export function getServicesByCategory(categoryCode) {
  return Object.values(SERVICES_CATALOG).filter((s) => s.category === categoryCode);
}

export function formatPriceToman(amount) {
  if (!amount) return 'رایگان / توافقی';
  return `${Number(amount).toLocaleString('fa-IR')} تومان`;
}

/**
 * تبدیل اعداد فارسی و عربی به انگلیسی برای اعتبارسنجی دقیق
 */
export function normalizeDigits(str) {
  return String(str ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}
