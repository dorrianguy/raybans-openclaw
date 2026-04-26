/**
 * Tests for Landing Page Data Engine — Marketing content and ROI calculator
 */

import { describe, it, expect } from 'vitest';
import {
  generateLandingPageData,
  generateSEOMetadata,
  generateHeroSection,
  generateFeatureSection,
  generateHowItWorksSection,
  generatePricingSection,
  generateComparisonSection,
  generateTestimonialSection,
  generateROICalculatorSection,
  generateFAQSection,
  generateCTASection,
  generateFooterSection,
  calculateROI,
} from './landing-page-data.js';

const BASE_URL = 'https://inventoryvision.ai';

describe('Landing Page Data Engine', () => {
  // ─── Full Page Generation ───────────────────────────────────

  describe('Full Page Generation', () => {
    it('should generate complete landing page data', () => {
      const data = generateLandingPageData(BASE_URL);
      expect(data.meta).toBeDefined();
      expect(data.hero).toBeDefined();
      expect(data.features).toBeDefined();
      expect(data.howItWorks).toBeDefined();
      expect(data.pricing).toBeDefined();
      expect(data.comparison).toBeDefined();
      expect(data.testimonials).toBeDefined();
      expect(data.roi).toBeDefined();
      expect(data.faq).toBeDefined();
      expect(data.cta).toBeDefined();
      expect(data.footer).toBeDefined();
    });

    it('should use default base URL when not provided', () => {
      const data = generateLandingPageData();
      expect(data.meta.canonicalUrl).toBe('https://inventoryvision.ai');
    });
  });

  // ─── SEO Metadata ──────────────────────────────────────────

  describe('SEO Metadata', () => {
    it('should generate valid SEO metadata', () => {
      const meta = generateSEOMetadata(BASE_URL);
      expect(meta.title).toContain('Inventory Vision');
      expect(meta.description.length).toBeLessThan(160);
      expect(meta.keywords.length).toBeGreaterThanOrEqual(10);
      expect(meta.ogTitle).toBeTruthy();
      expect(meta.ogDescription).toBeTruthy();
      expect(meta.ogImage).toContain(BASE_URL);
      expect(meta.twitterCard).toBe('summary_large_image');
      expect(meta.canonicalUrl).toBe(BASE_URL);
    });

    it('should include structured data', () => {
      const meta = generateSEOMetadata(BASE_URL);
      expect(meta.structuredData['@context']).toBe('https://schema.org');
      expect(meta.structuredData['@type']).toBe('SoftwareApplication');
      expect(meta.structuredData.name).toBe('Inventory Vision');
    });

    it('should include pricing in structured data', () => {
      const meta = generateSEOMetadata(BASE_URL);
      const offers = meta.structuredData.offers as Record<string, unknown>;
      expect(offers.lowPrice).toBe('79');
      expect(offers.priceCurrency).toBe('USD');
    });

    it('should include relevant keywords', () => {
      const meta = generateSEOMetadata(BASE_URL);
      expect(meta.keywords).toContain('inventory management');
      expect(meta.keywords).toContain('smart glasses inventory');
      expect(meta.keywords).toContain('automated inventory counting');
    });
  });

  // ─── Hero Section ──────────────────────────────────────────

  describe('Hero Section', () => {
    it('should generate hero content', () => {
      const hero = generateHeroSection(BASE_URL);
      expect(hero.headline).toBeTruthy();
      expect(hero.subheadline).toBeTruthy();
      expect(hero.description).toBeTruthy();
    });

    it('should have primary and secondary CTAs', () => {
      const hero = generateHeroSection(BASE_URL);
      expect(hero.primaryCTA.text).toBeTruthy();
      expect(hero.primaryCTA.url).toContain(BASE_URL);
      expect(hero.primaryCTA.variant).toBe('primary');
      expect(hero.secondaryCTA.variant).toBe('outline');
    });

    it('should have compelling stats', () => {
      const hero = generateHeroSection(BASE_URL);
      expect(hero.stats.length).toBeGreaterThanOrEqual(3);
      hero.stats.forEach(stat => {
        expect(stat.value).toBeTruthy();
        expect(stat.label).toBeTruthy();
      });
    });

    it('should include 90% less labor stat', () => {
      const hero = generateHeroSection(BASE_URL);
      const laborStat = hero.stats.find(s => s.label.includes('Labor'));
      expect(laborStat).toBeDefined();
      expect(laborStat!.value).toBe('90');
    });
  });

  // ─── Features ──────────────────────────────────────────────

  describe('Features', () => {
    it('should list all core features', () => {
      const features = generateFeatureSection();
      expect(features.features.length).toBeGreaterThanOrEqual(8);
      features.features.forEach(f => {
        expect(f.id).toBeTruthy();
        expect(f.title).toBeTruthy();
        expect(f.description).toBeTruthy();
        expect(f.icon).toBeTruthy();
        expect(f.benefits.length).toBeGreaterThanOrEqual(3);
      });
    });

    it('should have auto-capture feature', () => {
      const features = generateFeatureSection();
      const autoSnap = features.features.find(f => f.id === 'auto-snap');
      expect(autoSnap).toBeDefined();
      expect(autoSnap!.title).toContain('Auto');
    });

    it('should have voice feature', () => {
      const features = generateFeatureSection();
      const voice = features.features.find(f => f.id === 'voice');
      expect(voice).toBeDefined();
    });

    it('should mark premium features', () => {
      const features = generateFeatureSection();
      const premium = features.features.filter(f => f.premium);
      expect(premium.length).toBeGreaterThan(0);
    });

    it('should have unique IDs', () => {
      const features = generateFeatureSection();
      const ids = new Set(features.features.map(f => f.id));
      expect(ids.size).toBe(features.features.length);
    });
  });

  // ─── How It Works ─────────────────────────────────────────

  describe('How It Works', () => {
    it('should have exactly 3 steps', () => {
      const how = generateHowItWorksSection();
      expect(how.steps.length).toBe(3);
    });

    it('should have sequential step numbers', () => {
      const how = generateHowItWorksSection();
      expect(how.steps[0].number).toBe(1);
      expect(how.steps[1].number).toBe(2);
      expect(how.steps[2].number).toBe(3);
    });

    it('should include duration hints', () => {
      const how = generateHowItWorksSection();
      how.steps.forEach(step => {
        expect(step.duration).toBeTruthy();
      });
    });

    it('should start with putting on glasses', () => {
      const how = generateHowItWorksSection();
      expect(how.steps[0].title.toLowerCase()).toContain('glasses');
    });
  });

  // ─── Pricing ──────────────────────────────────────────────

  describe('Pricing', () => {
    it('should have 5 pricing plans', () => {
      const pricing = generatePricingSection(BASE_URL);
      expect(pricing.plans.length).toBe(5);
    });

    it('should have a free plan', () => {
      const pricing = generatePricingSection(BASE_URL);
      const free = pricing.plans.find(p => p.id === 'free');
      expect(free).toBeDefined();
      expect(free!.monthlyPrice).toBe(0);
    });

    it('should have correct solo store pricing', () => {
      const pricing = generatePricingSection(BASE_URL);
      const solo = pricing.plans.find(p => p.id === 'solo_store');
      expect(solo).toBeDefined();
      expect(solo!.monthlyPrice).toBe(79);
      expect(solo!.yearlyPrice).toBe(790);
      expect(solo!.trialDays).toBe(14);
    });

    it('should have enterprise with highest pricing', () => {
      const pricing = generatePricingSection(BASE_URL);
      const ent = pricing.plans.find(p => p.id === 'enterprise');
      expect(ent).toBeDefined();
      expect(ent!.monthlyPrice).toBe(499);
      expect(ent!.trialDays).toBe(30);
    });

    it('should have pay-per-count plan', () => {
      const pricing = generatePricingSection(BASE_URL);
      const ppc = pricing.plans.find(p => p.id === 'pay_per_count');
      expect(ppc).toBeDefined();
      expect(ppc!.features.some(f => f.includes('$0.02'))).toBe(true);
    });

    it('should mark exactly one plan as popular', () => {
      const pricing = generatePricingSection(BASE_URL);
      const popular = pricing.plans.filter(p => p.popular);
      expect(popular.length).toBe(1);
      expect(popular[0].id).toBe('solo_store');
    });

    it('should have CTA for each plan', () => {
      const pricing = generatePricingSection(BASE_URL);
      pricing.plans.forEach(plan => {
        expect(plan.cta.text).toBeTruthy();
        expect(plan.cta.url).toContain(BASE_URL);
      });
    });

    it('should show yearly savings', () => {
      const pricing = generatePricingSection(BASE_URL);
      const solo = pricing.plans.find(p => p.id === 'solo_store')!;
      expect(solo.yearlySavingsPercent).toBeGreaterThan(0);
      expect(solo.yearlyMonthlyEquivalent).toBeLessThan(solo.monthlyPrice);
    });

    it('should have billing toggle enabled', () => {
      const pricing = generatePricingSection(BASE_URL);
      expect(pricing.billingToggle).toBe(true);
    });
  });

  // ─── Competitor Comparison ────────────────────────────────

  describe('Competitor Comparison', () => {
    it('should compare against 3 competitors + us', () => {
      const comp = generateComparisonSection();
      expect(comp.competitors.length).toBe(4);
    });

    it('should include Inventory Vision as last entry', () => {
      const comp = generateComparisonSection();
      expect(comp.competitors[comp.competitors.length - 1].name).toBe('Inventory Vision');
    });

    it('should have multiple comparison features', () => {
      const comp = generateComparisonSection();
      expect(comp.features.length).toBeGreaterThanOrEqual(8);
    });

    it('should highlight key differentiators', () => {
      const comp = generateComparisonSection();
      const highlighted = comp.features.filter(f => f.highlight);
      expect(highlighted.length).toBeGreaterThan(0);
    });

    it('should show cost advantage', () => {
      const comp = generateComparisonSection();
      const cost = comp.features.find(f => f.name.includes('Cost'));
      expect(cost).toBeDefined();
      const ourValue = cost!.values[cost!.values.length - 1] as string;
      expect(ourValue.toLowerCase()).toContain('$79');
    });

    it('should have consistent value counts', () => {
      const comp = generateComparisonSection();
      comp.features.forEach(f => {
        expect(f.values.length).toBe(comp.competitors.length);
      });
    });
  });

  // ─── Testimonials ─────────────────────────────────────────

  describe('Testimonials', () => {
    it('should have multiple testimonials', () => {
      const t = generateTestimonialSection();
      expect(t.testimonials.length).toBeGreaterThanOrEqual(3);
    });

    it('should have required fields for each testimonial', () => {
      const t = generateTestimonialSection();
      t.testimonials.forEach(test => {
        expect(test.id).toBeTruthy();
        expect(test.quote.length).toBeGreaterThan(50);
        expect(test.author).toBeTruthy();
        expect(test.role).toBeTruthy();
        expect(test.company).toBeTruthy();
      });
    });

    it('should include success metrics', () => {
      const t = generateTestimonialSection();
      const withMetrics = t.testimonials.filter(test => test.metric);
      expect(withMetrics.length).toBeGreaterThan(0);
    });

    it('should have unique IDs', () => {
      const t = generateTestimonialSection();
      const ids = new Set(t.testimonials.map(test => test.id));
      expect(ids.size).toBe(t.testimonials.length);
    });
  });

  // ─── ROI Calculator ──────────────────────────────────────

  describe('ROI Calculator', () => {
    it('should generate calculator inputs', () => {
      const roi = generateROICalculatorSection();
      expect(roi.inputs.length).toBeGreaterThanOrEqual(5);
      roi.inputs.forEach(input => {
        expect(input.id).toBeTruthy();
        expect(input.label).toBeTruthy();
        expect(input.defaultValue).toBeGreaterThanOrEqual(input.min);
        expect(input.defaultValue).toBeLessThanOrEqual(input.max);
        expect(input.unit).toBeTruthy();
      });
    });

    it('should have a formula', () => {
      const roi = generateROICalculatorSection();
      expect(roi.formula).toBeTruthy();
    });

    it('should calculate ROI for typical convenience store', () => {
      const result = calculateROI({
        storeCount: 1,
        skuCount: 3000,
        countsPerYear: 4,
        teamSize: 4,
        hourlyRate: 18,
        daysPerCount: 2,
        planCostMonthly: 79,
      });

      expect(result.currentAnnualCost).toBeGreaterThan(0);
      expect(result.newAnnualCost).toBeGreaterThan(0);
      expect(result.annualSavings).toBeGreaterThan(0);
      expect(result.hoursRecovered).toBeGreaterThan(0);
      expect(result.roiMultiple).toBeGreaterThan(1); // should be profitable
    });

    it('should show significant savings for larger operations', () => {
      const result = calculateROI({
        storeCount: 5,
        skuCount: 10000,
        countsPerYear: 4,
        teamSize: 6,
        hourlyRate: 22,
        daysPerCount: 3,
        planCostMonthly: 199,
      });

      expect(result.annualSavings).toBeGreaterThan(10000);
      expect(result.roiMultiple).toBeGreaterThan(3);
    });

    it('should handle single person operation', () => {
      const result = calculateROI({
        storeCount: 1,
        skuCount: 500,
        countsPerYear: 2,
        teamSize: 1,
        hourlyRate: 15,
        daysPerCount: 1,
        planCostMonthly: 79,
      });

      // Even small operations should have reasonable numbers
      expect(result.currentAnnualCost).toBeGreaterThan(0);
      expect(result.newAnnualCost).toBeGreaterThan(0);
    });

    it('should calculate payback period', () => {
      const result = calculateROI({
        storeCount: 1,
        skuCount: 3000,
        countsPerYear: 4,
        teamSize: 4,
        hourlyRate: 18,
        daysPerCount: 2,
        planCostMonthly: 79,
      });

      expect(result.paybackDays).toBeGreaterThan(0);
      expect(result.paybackDays).toBeLessThan(365); // should pay back within a year
    });

    it('should handle zero plan cost', () => {
      const result = calculateROI({
        storeCount: 1,
        skuCount: 100,
        countsPerYear: 2,
        teamSize: 1,
        hourlyRate: 15,
        daysPerCount: 1,
        planCostMonthly: 0,
      });

      expect(result.roiMultiple).toBe(0); // division by zero handled
    });

    it('should never return negative savings', () => {
      const result = calculateROI({
        storeCount: 1,
        skuCount: 50,
        countsPerYear: 1,
        teamSize: 1,
        hourlyRate: 10,
        daysPerCount: 0.5,
        planCostMonthly: 499,
      });

      expect(result.annualSavings).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── FAQ ──────────────────────────────────────────────────

  describe('FAQ', () => {
    it('should have multiple FAQs', () => {
      const faq = generateFAQSection();
      expect(faq.faqs.length).toBeGreaterThanOrEqual(10);
    });

    it('should have question and answer for each', () => {
      const faq = generateFAQSection();
      faq.faqs.forEach(f => {
        expect(f.question.endsWith('?')).toBe(true);
        expect(f.answer.length).toBeGreaterThan(30);
      });
    });

    it('should cover hardware questions', () => {
      const faq = generateFAQSection();
      const hw = faq.faqs.find(f => f.category === 'hardware');
      expect(hw).toBeDefined();
    });

    it('should cover accuracy questions', () => {
      const faq = generateFAQSection();
      const accuracy = faq.faqs.filter(f => f.category === 'accuracy');
      expect(accuracy.length).toBeGreaterThan(0);
    });

    it('should cover security questions', () => {
      const faq = generateFAQSection();
      const security = faq.faqs.find(f => f.category === 'security');
      expect(security).toBeDefined();
      expect(security!.answer).toContain('encrypt');
    });

    it('should cover billing questions', () => {
      const faq = generateFAQSection();
      const billing = faq.faqs.find(f => f.category === 'billing');
      expect(billing).toBeDefined();
    });
  });

  // ─── CTA Section ──────────────────────────────────────────

  describe('CTA Section', () => {
    it('should have primary and secondary CTAs', () => {
      const cta = generateCTASection(BASE_URL);
      expect(cta.primaryCTA.variant).toBe('primary');
      expect(cta.secondaryCTA).toBeDefined();
    });

    it('should include guarantees', () => {
      const cta = generateCTASection(BASE_URL);
      expect(cta.guarantees.length).toBeGreaterThanOrEqual(3);
      expect(cta.guarantees.some(g => g.includes('credit card'))).toBe(true);
      expect(cta.guarantees.some(g => g.includes('Cancel'))).toBe(true);
    });
  });

  // ─── Footer ───────────────────────────────────────────────

  describe('Footer', () => {
    it('should have company info', () => {
      const footer = generateFooterSection(BASE_URL);
      expect(footer.companyName).toBe('Inventory Vision');
      expect(footer.tagline).toBeTruthy();
    });

    it('should have categorized links', () => {
      const footer = generateFooterSection(BASE_URL);
      expect(footer.links.length).toBeGreaterThanOrEqual(10);
      const categories = new Set(footer.links.map(l => l.category));
      expect(categories.has('Product')).toBe(true);
      expect(categories.has('Support')).toBe(true);
      expect(categories.has('Legal')).toBe(true);
    });

    it('should have social links', () => {
      const footer = generateFooterSection(BASE_URL);
      expect(footer.social.length).toBeGreaterThanOrEqual(3);
      const platforms = footer.social.map(s => s.platform.toLowerCase());
      expect(platforms).toContain('twitter');
      expect(platforms).toContain('github');
    });

    it('should have legal text', () => {
      const footer = generateFooterSection(BASE_URL);
      expect(footer.legal.length).toBeGreaterThanOrEqual(1);
      expect(footer.legal.some(l => l.includes('©'))).toBe(true);
    });

    it('should include Meta trademark disclaimer', () => {
      const footer = generateFooterSection(BASE_URL);
      expect(footer.legal.some(l => l.includes('Meta'))).toBe(true);
    });
  });
});
