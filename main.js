/**
 * SORA - HAIR & EYELASH — Main Script
 * - Shared header/footer injection
 * - Hero slideshow
 * - Scroll-based header style
 * - Mobile menu toggle
 */

(function () {
    'use strict';

    const SITE = {
        name: 'SORA',
        nameFull: 'SORA - HAIR & EYELASH -',
        tagline: '湘南・茅ヶ崎の隠れ家サロン',
        tel: '',
        email: '',
        address: '〒253-0055 神奈川県茅ヶ崎市中海岸1丁目2-43 サザンマンションB棟 2F',
        hours: '10:00 - 19:00',
        closed: '不定休',
        // TODO: 以下は確定次第差し替え
        reserve: {
            square: 'https://book.squareup.com/appointments/4f4hl9wpoa72f8/location/L40TADZ6SDMNC/services',
            line: 'https://lin.ee/OPEYoHK'
        },
        instagram: 'https://www.instagram.com/sora_hair_eyelashsalon/'
    };

    // ============================================
    // Header / Navigation
    // ============================================
    function injectHeader() {
        const el = document.getElementById('site-header');
        if (!el) return;
        el.innerHTML = `
            <div class="header-inner">
                <a href="./" class="header-logo">
                    <img src="SORA Main Logo.svg" alt="${SITE.nameFull}">
                </a>
                <nav class="nav-main" id="nav-main">
                    <a href="index.html">Home</a>
                    <a href="menu.html">Menu</a>
                    <a href="staff.html">Staff</a>
                    <a href="blog.html">Blog</a>
                    <a href="voice.html">Voice</a>
                    <a href="about.html">About</a>
                    <a href="access.html">Access</a>
                    <a href="contact.html" class="nav-cta">Reserve</a>
                </nav>
                <button class="menu-toggle" id="menu-toggle" aria-label="menu">
                    <span></span><span></span><span></span>
                </button>
            </div>
        `;
        const toggle = document.getElementById('menu-toggle');
        const nav = document.getElementById('nav-main');
        toggle?.addEventListener('click', () => nav.classList.toggle('open'));
    }

    function injectFooter() {
        const el = document.getElementById('site-footer');
        if (!el) return;
        const year = new Date().getFullYear();
        el.innerHTML = `
            <div class="container">
                <div class="footer-grid">
                    <div>
                        <div class="footer-logo">
                            <img src="SORA Main Logo.svg" alt="${SITE.nameFull}">
                        </div>
                        <p class="footer-about">
                            ${SITE.tagline}。<br>
                            まつ毛・ヘア・ヘッドスパまで、<br>
                            ひとりひとりに寄り添う癒しの時間を。
                        </p>
                        <p class="footer-meta">
                            ${SITE.address}<br>
                            営業時間 ${SITE.hours}<br>
                            定休日 ${SITE.closed}
                        </p>
                    </div>
                    <div>
                        <div class="footer-title">Menu</div>
                        <ul class="footer-nav">
                            <li><a href="menu.html#eyelash">Eyelash</a></li>
                            <li><a href="menu.html#brow">Brow</a></li>
                            <li><a href="menu.html#hair">Hair</a></li>
                            <li><a href="menu.html#spa">Head Spa</a></li>
                            <li><a href="menu.html#dressing">Dressing</a></li>
                        </ul>
                    </div>
                    <div>
                        <div class="footer-title">Salon</div>
                        <ul class="footer-nav">
                            <li><a href="about.html">About</a></li>
                            <li><a href="staff.html">Staff</a></li>
                            <li><a href="blog.html">Blog</a></li>
                            <li><a href="voice.html">Voice</a></li>
                            <li><a href="access.html">Access</a></li>
                            <li><a href="contact.html">Contact</a></li>
                            <li><a href="privacy.html">Privacy Policy</a></li>
                        </ul>
                    </div>
                    <div>
                        <div class="footer-title">Reserve & SNS</div>
                        <ul class="footer-nav">
                            <li><a href="${SITE.reserve.square}" target="_blank" rel="noopener">Square予約</a></li>
                            <li><a href="${SITE.reserve.line}" target="_blank" rel="noopener">LINE公式</a></li>
                            <li><a href="${SITE.instagram}" target="_blank" rel="noopener">Instagram</a></li>
                        </ul>
                    </div>
                </div>
                <div class="footer-bottom">
                    © ${year} ${SITE.nameFull} — All Rights Reserved.
                </div>
            </div>
        `;
    }

    // ============================================
    // Header scroll behavior
    // ============================================
    function initHeaderScroll() {
        const header = document.getElementById('site-header');
        if (!header) return;
        const update = () => {
            if (window.scrollY > 40) header.classList.add('scrolled');
            else header.classList.remove('scrolled');
        };
        update();
        window.addEventListener('scroll', update, { passive: true });
    }

    // ============================================
    // Hero slideshow
    // ============================================
    function initHeroSlideshow() {
        const slides = document.querySelectorAll('.hero-slide');
        if (slides.length < 2) return;
        let idx = 0;
        slides[0].classList.add('active');
        setInterval(() => {
            slides[idx].classList.remove('active');
            idx = (idx + 1) % slides.length;
            slides[idx].classList.add('active');
        }, 6000);
    }

    // ============================================
    // Init
    // ============================================
    document.addEventListener('DOMContentLoaded', () => {
        injectHeader();
        injectFooter();
        initHeaderScroll();
        initHeroSlideshow();
    });
})();
