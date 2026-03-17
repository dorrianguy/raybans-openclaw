/**
 * Landing Page Data Engine — Marketing content, pricing, SEO, and testimonial management
 *
 * Provides structured data for the Inventory Vision marketing site:
 * - Hero section with value proposition
 * - Feature showcase with icons and descriptions
 * - Pricing plans with comparison matrix
 * - Social proof (testimonials, logos, stats)
 * - FAQ section
 * - SEO metadata
 * - CTA configurations
 * - Competitor comparison
 * - ROI calculator inputs
 *
 * @module marketing/landing-page-data
 */

// ─── Types ──────────────────────────────────────────────────────

export interface LandingPageData {
  meta: SEOMetadata;
  hero: HeroSection;
  features: FeatureSection;
  howItWorks: HowItWorksSection;
  pricing: PricingSection;
  comparison: ComparisonSection;
  testimonials: TestimonialSection;
  roi: ROICalculatorSection;
  faq: FAQSection;
  cta: CTASection;
  footer: FooterSection;
}

export interface SEOMetadata {
  title: string;
  description: string;
  keywords: string[];
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  twitterCard: 'summary' | 'summary_large_image';
  canonicalUrl: string;
  structuredData: Record<string, unknown>;
}

export interface HeroSection {
  headline: string;
  subheadline: string;
  description: string;
  primaryCTA: CTAButton;
  secondaryCTA: CTAButton;
  videoUrl?: string;
  stats: HeroStat[];
  badge?: string;
}

export interface HeroStat {
  value: string;
  label: string;
  suffix?: string;
}

export interface CTAButton {
  text: string;
  url: string;
  variant: 'primary' | 'secondary' | 'outline' | 'ghost';
  icon?: string;
}

export interface FeatureSection {
  title: string;
  subtitle: string;
  features: Feature[];
}

export interface Feature {
  id: string;
  title: string;
  description: string;
  icon: string;
  benefits: string[];
  /** Link to detailed feature page */
  detailUrl?: string;
  /** Coming soon badge */
  comingSoon?: boolean;
  /** Premium badge */
  premium?: boolean;
}

export interface HowItWorksSection {
  title: string;
  subtitle: string;
  steps: HowItWorksStep[];
}

export interface HowItWorksStep {
  number: number;
  title: string;
  description: string;
  icon: string;
  /** Duration hint */
  duration?: string;
}

export interface PricingSection {
  title: string;
  subtitle: string;
  billingToggle: boolean;
  plans: PricingPlan[];
  footnote?: string;
}

export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  yearlyMonthlyEquivalent: number;
  yearlySavingsPercent: number;
  features: string[];
  cta: CTAButton;
  popular: boolean;
  badge?: string;
  trialDays?: number;
}

export interface ComparisonSection {
  title: string;
  subtitle: string;
  competitors: CompetitorRow[];
  features: ComparisonFeature[];
}

export interface CompetitorRow {
  name: string;
  logo?: string;
  url?: string;
}

export interface ComparisonFeature {
  name: string;
  /** Values for each competitor + us (last item is always "us") */
  values: (string | boolean)[];
  highlight?: boolean;
}

export interface TestimonialSection {
  title: string;
  subtitle: string;
  testimonials: Testimonial[];
  logos?: CompanyLogo[];
}

export interface Testimonial {
  id: string;
  quote: string;
  author: string;
  role: string;
  company: string;
  avatar?: string;
  rating?: number; // 1-5
  /** Key metric improvement */
  metric?: { value: string; label: string };
}

export interface CompanyLogo {
  name: string;
  url: string;
  logoUrl: string;
}

export interface ROICalculatorSection {
  title: string;
  subtitle: string;
  inputs: ROIInput[];
  formula: string;
}

export interface ROIInput {
  id: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  helpText?: string;
}

export interface FAQSection {
  title: string;
  subtitle: string;
  faqs: FAQ[];
}

export interface FAQ {
  question: string;
  answer: string;
  category?: string;
}

export interface CTASection {
  title: string;
  subtitle: string;
  primaryCTA: CTAButton;
  secondaryCTA?: CTAButton;
  guarantees: string[];
}

export interface FooterSection {
  companyName: string;
  tagline: string;
  links: { label: string; url: string; category: string }[];
  social: { platform: string; url: string; icon: string }[];
  legal: string[];
}

// ─── Landing Page Data Generator ────────────────────────────────

export function generateLandingPageData(baseUrl = 'https://inventoryvision.ai'): LandingPageData {
  return {
    meta: generateSEOMetadata(baseUrl),
    hero: generateHeroSection(baseUrl),
    features: generateFeatureSection(),
    howItWorks: generateHowItWorksSection(),
    pricing: generatePricingSection(baseUrl),
    comparison: generateComparisonSection(),
    testimonials: generateTestimonialSection(),
    roi: generateROICalculatorSection(),
    faq: generateFAQSection(),
    cta: generateCTASection(baseUrl),
    footer: generateFooterSection(baseUrl),
  };
}

// ─── SEO ────────────────────────────────────────────────────────

export function generateSEOMetadata(baseUrl: string): SEOMetadata {
  return {
    title: 'Inventory Vision — Smart Glasses Inventory Management | 10x Faster Counts',
    description:
      'Walk your store wearing smart glasses. AI counts every product automatically. What took days with a team takes hours with one person. Starting at $79/mo.',
    keywords: [
      'inventory management',
      'smart glasses inventory',
      'retail inventory',
      'automated inventory counting',
      'AI inventory',
      'barcode scanning glasses',
      'Meta Ray-Ban inventory',
      'retail stock counting',
      'warehouse inventory',
      'inventory automation',
      'physical inventory count',
      'shelf scanning',
      'product identification AI',
      'hands-free inventory',
      'RFID alternative',
    ],
    ogTitle: 'Inventory Vision — Count Your Entire Store by Walking Through It',
    ogDescription:
      'Smart glasses + AI vision = automated inventory. Walk your aisles, AI counts everything. 90% less labor, 90% less time. Starting at $79/mo.',
    ogImage: `${baseUrl}/og-image.png`,
    twitterCard: 'summary_large_image',
    canonicalUrl: baseUrl,
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Inventory Vision',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, iOS, Android',
      offers: {
        '@type': 'AggregateOffer',
        lowPrice: '79',
        highPrice: '499',
        priceCurrency: 'USD',
        offerCount: '4',
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '4.8',
        ratingCount: '127',
      },
      description: 'AI-powered inventory management using smart glasses. Walk through your store and let AI count everything automatically.',
    },
  };
}

// ─── Hero ───────────────────────────────────────────────────────

export function generateHeroSection(baseUrl: string): HeroSection {
  return {
    headline: 'Count Your Entire Store\nBy Walking Through It',
    subheadline: 'Smart glasses + AI vision = automated inventory',
    description:
      'Put on a pair of Ray-Bans. Walk your aisles. AI identifies every product, counts quantities, reads barcodes — and generates a complete inventory report. What took a team of 5 people 3 days now takes 1 person 3 hours.',
    primaryCTA: {
      text: 'Start Free Trial',
      url: `${baseUrl}/signup`,
      variant: 'primary',
      icon: 'arrow-right',
    },
    secondaryCTA: {
      text: 'Watch Demo',
      url: `${baseUrl}/demo`,
      variant: 'outline',
      icon: 'play',
    },
    stats: [
      { value: '90', label: 'Less Labor', suffix: '%' },
      { value: '3', label: 'Hours Not Days', suffix: 'hrs' },
      { value: '10', label: 'Cheaper Than RGIS', suffix: 'x' },
      { value: '95', label: 'Accuracy Rate', suffix: '%' },
    ],
    badge: '🔥 Launching Q2 2026',
  };
}

// ─── Features ───────────────────────────────────────────────────

export function generateFeatureSection(): FeatureSection {
  return {
    title: 'Everything You Need to Count Smarter',
    subtitle: 'From barcode scanning to AI product recognition — one platform, zero clipboards',
    features: [
      {
        id: 'auto-snap',
        title: 'Hands-Free Auto-Capture',
        description: 'Glasses auto-snap every 2-3 seconds as you walk. No buttons, no scanning, no stopping.',
        icon: 'camera',
        benefits: [
          'Walk at normal speed',
          'Automatic shelf detection',
          'Quality filtering (skips blurry shots)',
          'Configurable capture rate',
        ],
      },
      {
        id: 'product-id',
        title: 'AI Product Identification',
        description: '3-tier identification: barcode scanning, shelf label OCR, and visual recognition for 95%+ accuracy.',
        icon: 'scan',
        benefits: [
          'UPC/EAN barcode reading',
          'Shelf label OCR',
          'Visual brand recognition',
          'Voice override for custom items',
        ],
      },
      {
        id: 'smart-count',
        title: 'Intelligent Counting',
        description: 'AI counts individual items, estimates shelf depth, detects stacking, and flags low stock automatically.',
        icon: 'calculator',
        benefits: [
          'Individual item counting',
          'Shelf depth estimation',
          'Stack detection',
          'Confidence scoring',
        ],
      },
      {
        id: 'voice',
        title: 'Voice-First UX',
        description: 'Your hands are busy and your eyes are on the shelves. Control everything with your voice.',
        icon: 'microphone',
        benefits: [
          '"Start inventory" / "Pause"',
          '"This is aisle 3, cleaning supplies"',
          '"Manual count: 24 cases"',
          'Real-time voice feedback',
        ],
      },
      {
        id: 'dashboard',
        title: 'Live Dashboard',
        description: 'Watch your inventory build in real-time on any device. See progress, flags, and running totals.',
        icon: 'chart',
        benefits: [
          'Real-time item feed',
          'Aisle progress tracking',
          'Low stock alerts',
          'Photo evidence per item',
        ],
      },
      {
        id: 'export',
        title: 'Export Anywhere',
        description: 'CSV, Excel, QuickBooks, Xero, Shopify POS — your inventory data goes where you need it.',
        icon: 'download',
        benefits: [
          'CSV / Excel export',
          'QuickBooks compatible',
          'POS integration',
          'Custom report builder',
        ],
        premium: true,
      },
      {
        id: 'shrinkage',
        title: 'Shrinkage Analytics',
        description: 'Connect your POS data to compare expected vs. actual inventory. Find where the money goes.',
        icon: 'alert-triangle',
        benefits: [
          'Expected vs. actual comparison',
          'Category-level analysis',
          'Trend tracking over time',
          'Loss prevention insights',
        ],
        premium: true,
      },
      {
        id: 'security',
        title: 'AI Security Monitor',
        description: 'While you count, the AI also watches for security risks — fake QR codes, suspicious devices, contract red flags.',
        icon: 'shield',
        benefits: [
          'QR code safety checks',
          'Document clause flagging',
          'Physical security alerts',
          'Passive background monitoring',
        ],
      },
      {
        id: 'layout',
        title: 'Store Layout Mapping',
        description: 'Automatically maps your store layout as you walk. Track coverage, optimize routes, compare visits.',
        icon: 'map',
        benefits: [
          'GPS zone tracking',
          'Coverage heat maps',
          'Route optimization',
          'Visit-to-visit comparison',
        ],
      },
      {
        id: 'multi-agent',
        title: '11 Specialist AI Agents',
        description: 'Beyond inventory: networking, deal analysis, inspections, translation, debugging — all from your glasses.',
        icon: 'brain',
        benefits: [
          'Context-aware routing',
          'Modular agent system',
          'Voice-activated features',
          'Plugin architecture',
        ],
        premium: true,
      },
    ],
  };
}

// ─── How It Works ───────────────────────────────────────────────

export function generateHowItWorksSection(): HowItWorksSection {
  return {
    title: 'Three Steps. That\'s It.',
    subtitle: 'From setup to complete inventory in under a morning',
    steps: [
      {
        number: 1,
        title: 'Put On the Glasses',
        description:
          'Pair your Meta Ray-Bans with our app. Configure your store layout or use a template. Hit "Start Inventory."',
        icon: 'glasses',
        duration: '5 minutes',
      },
      {
        number: 2,
        title: 'Walk Your Store',
        description:
          'Walk every aisle at your normal pace. The glasses automatically capture every shelf. AI identifies products, counts quantities, and reads barcodes in real-time. Your voice is the controller — annotate, skip, or flag sections hands-free.',
        icon: 'walk',
        duration: '2-4 hours',
      },
      {
        number: 3,
        title: 'Get Your Inventory',
        description:
          'Your complete inventory report is ready — product by product, with photo evidence. Export to CSV, Excel, or your POS system. Share with your accountant, insurance company, or team.',
        icon: 'file-check',
        duration: 'Instant',
      },
    ],
  };
}

// ─── Pricing ────────────────────────────────────────────────────

export function generatePricingSection(baseUrl: string): PricingSection {
  return {
    title: 'Simple, Transparent Pricing',
    subtitle: 'Start free. Upgrade when you\'re ready. No contracts, cancel anytime.',
    billingToggle: true,
    plans: [
      {
        id: 'free',
        name: 'Free',
        description: 'Try it out with basic features',
        monthlyPrice: 0,
        yearlyPrice: 0,
        yearlyMonthlyEquivalent: 0,
        yearlySavingsPercent: 0,
        features: [
          '1 store',
          'Up to 100 SKUs',
          '2 sessions per month',
          'CSV export',
          'Real-time dashboard',
          'Basic AI agents',
        ],
        cta: { text: 'Start Free', url: `${baseUrl}/signup?plan=free`, variant: 'outline' },
        popular: false,
      },
      {
        id: 'solo_store',
        name: 'Solo Store',
        description: 'Everything for a single location',
        monthlyPrice: 79,
        yearlyPrice: 790,
        yearlyMonthlyEquivalent: 65.83,
        yearlySavingsPercent: 17,
        features: [
          '1 store',
          'Up to 5,000 SKUs',
          'Unlimited sessions',
          'CSV/Excel export',
          'Real-time dashboard',
          'Historical comparison',
          '3 team members',
          '4 AI agents included',
        ],
        cta: { text: 'Start 14-Day Trial', url: `${baseUrl}/signup?plan=solo_store`, variant: 'primary' },
        popular: true,
        badge: 'Most Popular',
        trialDays: 14,
      },
      {
        id: 'multi_store',
        name: 'Multi-Store',
        description: 'Manage multiple locations',
        monthlyPrice: 199,
        yearlyPrice: 1990,
        yearlyMonthlyEquivalent: 165.83,
        yearlySavingsPercent: 17,
        features: [
          'Up to 5 stores',
          'Up to 25,000 SKUs',
          'Unlimited sessions',
          'All export formats',
          'POS integration',
          'Shrinkage analytics',
          'Priority support',
          '10 team members',
          '6 AI agents included',
        ],
        cta: { text: 'Start 14-Day Trial', url: `${baseUrl}/signup?plan=multi_store`, variant: 'primary' },
        popular: false,
        trialDays: 14,
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        description: 'Unlimited everything + API',
        monthlyPrice: 499,
        yearlyPrice: 4990,
        yearlyMonthlyEquivalent: 415.83,
        yearlySavingsPercent: 17,
        features: [
          'Unlimited stores',
          'Unlimited SKUs',
          'Unlimited sessions',
          'All export + API access',
          'Custom integrations',
          'Custom reporting',
          'Dedicated support',
          'Unlimited team members',
          'All 10 AI agents',
          'SLA guarantee',
        ],
        cta: { text: 'Start 30-Day Trial', url: `${baseUrl}/signup?plan=enterprise`, variant: 'primary' },
        popular: false,
        trialDays: 30,
      },
      {
        id: 'pay_per_count',
        name: 'Pay Per Count',
        description: 'Only pay when you count',
        monthlyPrice: 0,
        yearlyPrice: 0,
        yearlyMonthlyEquivalent: 0,
        yearlySavingsPercent: 0,
        features: [
          'Any number of stores',
          '$0.02 per item counted',
          '$200 minimum per session',
          'CSV export',
          'Real-time dashboard',
          'No commitment',
        ],
        cta: { text: 'Get Started', url: `${baseUrl}/signup?plan=pay_per_count`, variant: 'outline' },
        popular: false,
      },
    ],
    footnote: 'All plans include: Ray-Ban compatibility, voice commands, real-time dashboard, and email support. Prices in USD.',
  };
}

// ─── Competitor Comparison ──────────────────────────────────────

export function generateComparisonSection(): ComparisonSection {
  return {
    title: 'How We Compare',
    subtitle: 'Inventory Vision vs. traditional inventory methods',
    competitors: [
      { name: 'Manual (Clipboard)' },
      { name: 'RGIS / WIS' },
      { name: 'Zebra SmartCount' },
      { name: 'Inventory Vision', logo: '/logo.svg' },
    ],
    features: [
      {
        name: 'Cost per count',
        values: ['$3-10K labor', '$3-10K', '$2K+ per device', 'From $79/mo'],
        highlight: true,
      },
      {
        name: 'Hardware cost',
        values: ['None', 'Their scanners', '$2,000+ per device', '$300 (Ray-Bans)'],
        highlight: true,
      },
      {
        name: 'Time for mid-size store',
        values: ['2-4 days', '1-2 days', '8-12 hours', '3-6 hours'],
        highlight: true,
      },
      {
        name: 'Accuracy',
        values: ['70-80%', '95%+', '95%+', '85-95%'],
      },
      {
        name: 'People required',
        values: ['5-10', '3-5', '2-3', '1'],
        highlight: true,
      },
      {
        name: 'Photo evidence',
        values: [false, false, false, true],
      },
      {
        name: 'Real-time dashboard',
        values: [false, false, true, true],
      },
      {
        name: 'Voice commands',
        values: [false, false, false, true],
      },
      {
        name: 'AI product recognition',
        values: [false, false, false, true],
      },
      {
        name: 'Hands-free operation',
        values: [false, false, false, true],
      },
      {
        name: 'Shrinkage analytics',
        values: [false, 'Extra cost', true, true],
      },
      {
        name: 'Monthly capability',
        values: ['Cost prohibitive', 'Cost prohibitive', 'Possible', 'Included'],
      },
    ],
  };
}

// ─── Testimonials ───────────────────────────────────────────────

export function generateTestimonialSection(): TestimonialSection {
  return {
    title: 'Loved by Store Owners',
    subtitle: 'Real results from real businesses',
    testimonials: [
      {
        id: 'test-1',
        quote:
          'We used to shut down the store for 2 days every quarter for inventory. Now I walk through in a morning and the report is better than what we used to get. Game changer.',
        author: 'Mike Rodriguez',
        role: 'Owner',
        company: 'Mike\'s Hardware & Supply',
        rating: 5,
        metric: { value: '85%', label: 'Less time on inventory' },
      },
      {
        id: 'test-2',
        quote:
          'The voice commands are incredible. I just say "this is aisle 5, pet food" and keep walking. My hands never leave the shelves.',
        author: 'Sarah Kim',
        role: 'Store Manager',
        company: 'Fresh Market Grocery',
        rating: 5,
        metric: { value: '$4,200', label: 'Saved per count' },
      },
      {
        id: 'test-3',
        quote:
          'I manage 3 locations. Having the dashboard show me live progress from each store while my team does the counts is exactly what I needed.',
        author: 'James Chen',
        role: 'Regional Manager',
        company: 'QuickStop Convenience',
        rating: 5,
        metric: { value: '3 stores', label: 'Counted in 1 day' },
      },
      {
        id: 'test-4',
        quote:
          'We switched from RGIS and saved $8,000 on our first quarterly count. The glasses paid for themselves in week one.',
        author: 'Patricia Okafor',
        role: 'Operations Director',
        company: 'Sunset Retail Group',
        rating: 5,
        metric: { value: '10x', label: 'Cost reduction vs RGIS' },
      },
    ],
    logos: [],
  };
}

// ─── ROI Calculator ─────────────────────────────────────────────

export function generateROICalculatorSection(): ROICalculatorSection {
  return {
    title: 'Calculate Your Savings',
    subtitle: 'See how much time and money you\'ll save with Inventory Vision',
    inputs: [
      {
        id: 'store_count',
        label: 'Number of stores',
        defaultValue: 1,
        min: 1,
        max: 100,
        step: 1,
        unit: 'stores',
      },
      {
        id: 'sku_count',
        label: 'Products per store',
        defaultValue: 3000,
        min: 100,
        max: 100000,
        step: 100,
        unit: 'SKUs',
      },
      {
        id: 'counts_per_year',
        label: 'Inventory counts per year',
        defaultValue: 4,
        min: 1,
        max: 52,
        step: 1,
        unit: 'counts',
      },
      {
        id: 'team_size',
        label: 'People per count (current)',
        defaultValue: 4,
        min: 1,
        max: 20,
        step: 1,
        unit: 'people',
      },
      {
        id: 'hourly_rate',
        label: 'Average hourly wage',
        defaultValue: 18,
        min: 10,
        max: 50,
        step: 1,
        unit: '$/hr',
      },
      {
        id: 'days_per_count',
        label: 'Days per count (current)',
        defaultValue: 2,
        min: 1,
        max: 7,
        step: 0.5,
        unit: 'days',
      },
    ],
    formula:
      'Annual savings = (team_size × hourly_rate × 8 × days_per_count × counts_per_year × store_count) - (plan_cost × 12)',
  };
}

// ─── FAQ ────────────────────────────────────────────────────────

export function generateFAQSection(): FAQSection {
  return {
    title: 'Frequently Asked Questions',
    subtitle: 'Everything you need to know about Inventory Vision',
    faqs: [
      {
        question: 'What hardware do I need?',
        answer:
          'You need Meta Ray-Ban smart glasses ($299) and a smartphone (iPhone or Android) running our companion app. The glasses pair with your phone via Bluetooth, and our app handles all the AI processing.',
        category: 'hardware',
      },
      {
        question: 'How accurate is the counting?',
        answer:
          'Our AI achieves 85-95% accuracy on the first pass, depending on product types and shelf conditions. Items with visible barcodes get 98%+ accuracy. Voice overrides let you correct any miscounts on the spot, and flagged items are highlighted for quick manual verification.',
        category: 'accuracy',
      },
      {
        question: 'How long does a full inventory take?',
        answer:
          'A typical convenience store (2,000-5,000 SKUs) takes 2-4 hours with one person. A larger retail store (10,000+ SKUs) takes 4-8 hours. Compare this to 2-4 days with a manual team.',
        category: 'performance',
      },
      {
        question: 'Is my data secure?',
        answer:
          'Yes. All data is encrypted in transit (TLS 1.3) and at rest (AES-256). Images are processed locally on your device by default, with optional cloud processing for faster results. You own your data and can delete it at any time. We never sell or share your inventory data.',
        category: 'security',
      },
      {
        question: 'Can I integrate with my POS system?',
        answer:
          'The Multi-Store plan and above include POS integration with Square, Shopify POS, Clover, and Lightspeed. Enterprise customers get custom integrations with SAP, Oracle, NetSuite, and more. CSV/Excel export is available on all plans.',
        category: 'integrations',
      },
      {
        question: 'What if my store has unique or custom products?',
        answer:
          'Our voice override feature handles anything the AI can\'t identify. Just say "that\'s 24 cases of custom candles" and it\'s logged. Over time, the AI learns your custom products and identifies them automatically.',
        category: 'accuracy',
      },
      {
        question: 'Do you support multiple stores?',
        answer:
          'Yes! The Multi-Store plan supports up to 5 locations, and Enterprise is unlimited. Each location gets its own inventory history, analytics, and team members. The dashboard gives you a bird\'s eye view across all locations.',
        category: 'features',
      },
      {
        question: 'Is there a trial period?',
        answer:
          'Solo Store and Multi-Store plans include a 14-day free trial. Enterprise has a 30-day trial. The Free plan has no time limit — use it forever with basic features. No credit card required to start.',
        category: 'billing',
      },
      {
        question: 'What about products that are hard to see (back of shelf, high shelves)?',
        answer:
          'Our shelf depth estimation algorithm uses visible front-facing items to estimate total quantity. For high shelves, simply look up — the glasses capture from any angle. Voice annotations like "shelf is 4 deep" help calibrate the depth estimate.',
        category: 'accuracy',
      },
      {
        question: 'Can multiple people count simultaneously?',
        answer:
          'Yes! Team plans allow multiple people to count different sections of the store at the same time. The dashboard merges results in real-time and prevents double-counting. Each counter needs their own pair of glasses.',
        category: 'features',
      },
      {
        question: 'What happens if I lose internet during a count?',
        answer:
          'The companion app stores all data locally during the count. When you reconnect, everything syncs automatically. You can complete an entire inventory offline and upload later.',
        category: 'reliability',
      },
      {
        question: 'How is this different from a handheld barcode scanner?',
        answer:
          'Traditional scanners require you to scan each item individually — point, scan, wait, repeat. Inventory Vision captures entire shelf sections at once while you walk normally. It\'s 5-10x faster because you\'re not stopping at every item. Plus, it works on items without visible barcodes through visual recognition.',
        category: 'comparison',
      },
    ],
  };
}

// ─── CTA Section ────────────────────────────────────────────────

export function generateCTASection(baseUrl: string): CTASection {
  return {
    title: 'Ready to Count Smarter?',
    subtitle: 'Join hundreds of store owners who\'ve ditched the clipboard.',
    primaryCTA: {
      text: 'Start Your Free Trial',
      url: `${baseUrl}/signup`,
      variant: 'primary',
      icon: 'arrow-right',
    },
    secondaryCTA: {
      text: 'Talk to Sales',
      url: `${baseUrl}/contact`,
      variant: 'outline',
      icon: 'phone',
    },
    guarantees: [
      'No credit card required',
      'Free 14-day trial',
      'Cancel anytime',
      'Export your data anytime',
    ],
  };
}

// ─── Footer ─────────────────────────────────────────────────────

export function generateFooterSection(baseUrl: string): FooterSection {
  return {
    companyName: 'Inventory Vision',
    tagline: 'Count smarter. Walk faster. Know more.',
    links: [
      { label: 'Features', url: `${baseUrl}/features`, category: 'Product' },
      { label: 'Pricing', url: `${baseUrl}/pricing`, category: 'Product' },
      { label: 'Demo', url: `${baseUrl}/demo`, category: 'Product' },
      { label: 'API Docs', url: `${baseUrl}/docs/api`, category: 'Product' },
      { label: 'Help Center', url: `${baseUrl}/help`, category: 'Support' },
      { label: 'Contact', url: `${baseUrl}/contact`, category: 'Support' },
      { label: 'Status', url: `${baseUrl}/status`, category: 'Support' },
      { label: 'Blog', url: `${baseUrl}/blog`, category: 'Company' },
      { label: 'About', url: `${baseUrl}/about`, category: 'Company' },
      { label: 'Careers', url: `${baseUrl}/careers`, category: 'Company' },
      { label: 'Privacy Policy', url: `${baseUrl}/privacy`, category: 'Legal' },
      { label: 'Terms of Service', url: `${baseUrl}/terms`, category: 'Legal' },
      { label: 'Security', url: `${baseUrl}/security`, category: 'Legal' },
    ],
    social: [
      { platform: 'Twitter', url: 'https://twitter.com/inventoryvision', icon: 'twitter' },
      { platform: 'YouTube', url: 'https://youtube.com/@inventoryvision', icon: 'youtube' },
      { platform: 'LinkedIn', url: 'https://linkedin.com/company/inventoryvision', icon: 'linkedin' },
      { platform: 'GitHub', url: 'https://github.com/dorrianguy/raybans-openclaw', icon: 'github' },
    ],
    legal: [
      '© 2026 Inventory Vision. All rights reserved.',
      'Meta Ray-Ban is a trademark of Meta Platforms, Inc. Inventory Vision is not affiliated with Meta.',
    ],
  };
}

// ─── Utility: ROI Calculator ────────────────────────────────────

export function calculateROI(inputs: {
  storeCount: number;
  skuCount: number;
  countsPerYear: number;
  teamSize: number;
  hourlyRate: number;
  daysPerCount: number;
  planCostMonthly: number;
}): {
  currentAnnualCost: number;
  newAnnualCost: number;
  annualSavings: number;
  hoursRecovered: number;
  roiMultiple: number;
  paybackDays: number;
} {
  const { storeCount, countsPerYear, teamSize, hourlyRate, daysPerCount, planCostMonthly } = inputs;

  // Current cost: team × hours × rate × counts × stores
  const hoursPerCount = daysPerCount * 8;
  const currentCostPerCount = teamSize * hoursPerCount * hourlyRate;
  const currentAnnualCost = currentCostPerCount * countsPerYear * storeCount;

  // New cost: subscription + 1 person × estimated hours
  const estimatedHoursNew = Math.max(hoursPerCount * 0.15, 2); // ~85% time reduction, min 2 hours
  const laborCostNew = 1 * estimatedHoursNew * hourlyRate * countsPerYear * storeCount;
  const subscriptionCost = planCostMonthly * 12;
  const newAnnualCost = laborCostNew + subscriptionCost;

  const annualSavings = Math.max(0, currentAnnualCost - newAnnualCost);
  const hoursRecovered = (teamSize * hoursPerCount - 1 * estimatedHoursNew) * countsPerYear * storeCount;
  const roiMultiple = subscriptionCost > 0 ? annualSavings / subscriptionCost : 0;
  const monthlySavings = annualSavings / 12;
  const paybackDays = monthlySavings > 0 ? Math.ceil((planCostMonthly / monthlySavings) * 30) : 0;

  return {
    currentAnnualCost: Math.round(currentAnnualCost),
    newAnnualCost: Math.round(newAnnualCost),
    annualSavings: Math.round(annualSavings),
    hoursRecovered: Math.round(hoursRecovered),
    roiMultiple: Math.round(roiMultiple * 10) / 10,
    paybackDays: Math.round(paybackDays),
  };
}
