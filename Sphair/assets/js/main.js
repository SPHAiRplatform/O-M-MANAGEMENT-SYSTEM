/**
* SPHAiRDigital Marketing Website
* Professional digital O&M system for solar power plant maintenance operations
* Copyright © SPHAiRDigital. All Rights Reserved.
*/

(function() {
  "use strict";

  /**
   * Apply .scrolled class to the body as the page is scrolled down
   */
  function toggleScrolled() {
    const selectBody = document.querySelector('body');
    const selectHeader = document.querySelector('#header');
    if (!selectHeader.classList.contains('scroll-up-sticky') && !selectHeader.classList.contains('sticky-top') && !selectHeader.classList.contains('fixed-top')) return;
    window.scrollY > 100 ? selectBody.classList.add('scrolled') : selectBody.classList.remove('scrolled');
  }

  document.addEventListener('scroll', toggleScrolled);
  window.addEventListener('load', toggleScrolled);

  /**
   * Mobile nav toggle
   */
  const mobileNavToggleBtn = document.querySelector('.mobile-nav-toggle');

  function mobileNavToogle() {
    document.querySelector('body').classList.toggle('mobile-nav-active');
    mobileNavToggleBtn.classList.toggle('bi-list');
    mobileNavToggleBtn.classList.toggle('bi-x');
  }
  if (mobileNavToggleBtn) {
    mobileNavToggleBtn.addEventListener('click', mobileNavToogle);
  }

  /**
   * Hide mobile nav on same-page/hash links
   */
  document.querySelectorAll('#navmenu a').forEach(navmenu => {
    navmenu.addEventListener('click', () => {
      if (document.querySelector('.mobile-nav-active')) {
        mobileNavToogle();
      }
    });

  });

  /**
   * Toggle mobile nav dropdowns
   */
  document.querySelectorAll('.navmenu .toggle-dropdown').forEach(navmenu => {
    navmenu.addEventListener('click', function(e) {
      e.preventDefault();
      this.parentNode.classList.toggle('active');
      this.parentNode.nextElementSibling.classList.toggle('dropdown-active');
      e.stopImmediatePropagation();
    });
  });

  /**
   * Scroll top button
   */
  let scrollTop = document.querySelector('.scroll-top');

  function toggleScrollTop() {
    if (scrollTop) {
      window.scrollY > 100 ? scrollTop.classList.add('active') : scrollTop.classList.remove('active');
    }
  }
  scrollTop.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });

  window.addEventListener('load', toggleScrollTop);
  document.addEventListener('scroll', toggleScrollTop);

  /**
   * Animation on scroll function and init
   */
  function aosInit() {
    AOS.init({
      duration: 600,
      easing: 'ease-in-out',
      once: true,
      mirror: false
    });
  }
  window.addEventListener('load', aosInit);

  /**
   * Initiate glightbox
   */
  const glightbox = GLightbox({
    selector: '.glightbox'
  });

  /**
   * Init swiper sliders
   */
  function initSwiper() {
    document.querySelectorAll(".init-swiper").forEach(function(swiperElement) {
      let config = JSON.parse(
        swiperElement.querySelector(".swiper-config").innerHTML.trim()
      );

      if (swiperElement.classList.contains("swiper-tab")) {
        initSwiperWithCustomPagination(swiperElement, config);
      } else {
        new Swiper(swiperElement, config);
      }
    });
  }

  window.addEventListener("load", initSwiper);

  /**
   * Initiate Pure Counter
   */
  new PureCounter();

  /*
   * Pricing Toggle (Monthly/Yearly)
   */
  const pricingContainers = document.querySelectorAll('.pricing-toggle-container');

  pricingContainers.forEach(function(container) {
    const pricingSwitch = container.querySelector('.pricing-toggle input[type="checkbox"]');
    const monthlyLabel = container.querySelector('.monthly');
    const yearlyLabel = container.querySelector('.yearly');

    if (pricingSwitch) {
      pricingSwitch.addEventListener('change', function() {
        const monthlyPrices = document.querySelectorAll('.price-monthly');
        const yearlyPrices = document.querySelectorAll('.price-yearly');

        if (this.checked) {
          monthlyLabel.classList.remove('active');
          yearlyLabel.classList.add('active');
          monthlyPrices.forEach(p => p.style.display = 'none');
          yearlyPrices.forEach(p => p.style.display = 'inline');
        } else {
          monthlyLabel.classList.add('active');
          yearlyLabel.classList.remove('active');
          monthlyPrices.forEach(p => p.style.display = 'inline');
          yearlyPrices.forEach(p => p.style.display = 'none');
        }
      });
    }
  });

  /**
   * Frequently Asked Questions Toggle
   */
  document.querySelectorAll('.faq-item h3, .faq-item .faq-toggle, .faq-item .faq-header').forEach((faqItem) => {
    faqItem.addEventListener('click', () => {
      faqItem.parentNode.classList.toggle('faq-active');
    });
  });

  /**
   * Clean URL navigation — map /home/section paths to on-page sections
   */
  const sectionMap = {
    '/home/about':    'about',
    '/home/services': 'services',
    '/home/contact':  'contact',
    '/home':          'hero',
    '/home/':         'hero',
  };

  const sections = [
    { id: 'hero',     path: '/home' },
    { id: 'about',    path: '/home/about' },
    { id: 'services', path: '/home/services' },
    { id: 'contact',  path: '/home/contact' },
  ];

  function scrollToSection(id) {
    const section = document.getElementById(id);
    if (!section) return;
    const scrollMarginTop = parseInt(getComputedStyle(section).scrollMarginTop) || 80;
    window.scrollTo({ top: section.offsetTop - scrollMarginTop, behavior: 'smooth' });
  }

  // Intercept nav clicks with clean URLs
  document.querySelectorAll('a[href^="/home"]').forEach(link => {
    const href = link.getAttribute('href');
    const sectionId = sectionMap[href];
    if (!sectionId) return; // let real pages (pricing, book-a-pilot) navigate normally
    link.addEventListener('click', function(e) {
      e.preventDefault();
      history.pushState(null, '', href);
      scrollToSection(sectionId);
      if (document.querySelector('.mobile-nav-active')) mobileNavToogle();
    });
  });

  // On load, scroll to the section matching the current path
  window.addEventListener('load', function() {
    const path = window.location.pathname.replace(/\/$/, '') || '/home';
    const sectionId = sectionMap[path];
    if (sectionId && sectionId !== 'hero') {
      history.replaceState(null, '', path);
      setTimeout(() => scrollToSection(sectionId), 100);
      setTimeout(() => scrollToSection(sectionId), 600);
    }
  });

  /**
   * Navmenu Scrollspy — update active link and URL as user scrolls
   */
  function navmenuScrollspy() {
    const position = window.scrollY + 200;
    let current = sections[0];

    sections.forEach(s => {
      const el = document.getElementById(s.id);
      if (el && position >= el.offsetTop) current = s;
    });

    // Update active nav link
    document.querySelectorAll('.navmenu a').forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === current.path) {
        link.classList.add('active');
      }
    });

    // Update URL without adding history entries, never use a hash
    if (window.location.pathname !== current.path || window.location.hash) {
      history.replaceState(null, '', current.path);
    }
  }

  window.addEventListener('load', navmenuScrollspy);
  document.addEventListener('scroll', navmenuScrollspy);

})();