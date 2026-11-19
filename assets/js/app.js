/* ==========================================================================
   陈明 · 个人简历网站交互
   内容来自 content/site.js，文章正文来自 content/posts/*.md
   原生 JavaScript，无依赖。
   ========================================================================= */
(function () {
  'use strict';

  var site = window.SITE;
  var MD = window.Markdown;
  var doc = document;
  var root = doc.documentElement;

  function $(selector, scope) { return (scope || doc).querySelector(selector); }
  function $$(selector, scope) { return Array.prototype.slice.call((scope || doc).querySelectorAll(selector)); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function externalAttr(url) {
    return /^https?:/i.test(url || '') ? ' target="_blank" rel="noopener noreferrer"' : '';
  }

  /* ---------- 图标 ---------- */
  var PATHS = {
    arrowUpRight: '<path d="M7 17 17 7M8 7h9v9"/>',
    arrowRight: '<path d="M4 12h15M13 6l6 6-6 6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.6 6.7"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.5-1.5"/>',
    github: '<path d="M9 19c-4 1.5-4-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.5 1.3a12 12 0 0 0-6.3 0C6.7 2.8 5.7 3.1 5.7 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.3 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
    x: '<path d="M5 5l14 14M19 5 5 19"/>',
    phone: '<path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'
  };
  function icon(name, className) {
    var path = PATHS[name] || PATHS.link;
    return '<svg class="icon ' + (className || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
  }

  /* ---------- 工具 ---------- */
  var toastTimer = null;
  function toast(message) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2200);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve) {
      var area = doc.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      doc.body.appendChild(area);
      area.select();
      try { doc.execCommand('copy'); } catch (error) { /* 忽略 */ }
      area.remove();
      resolve();
    });
  }

  function dateParts(iso) {
    var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return match ? { y: match[1], m: match[2], d: match[3] } : null;
  }
  function fmtDot(iso) {
    var p = dateParts(iso);
    return p ? p.y + '.' + p.m + '.' + p.d : (iso || '');
  }
  function fmtLong(iso) {
    var p = dateParts(iso);
    return p ? p.y + ' 年 ' + Number(p.m) + ' 月 ' + Number(p.d) + ' 日' : (iso || '');
  }

  if (!site || !MD) {
    var boot = $('#boot');
    if (boot) {
      $('#boot-text').textContent = '内容加载失败：没找到 content/site.js';
      boot.style.cursor = 'pointer';
      boot.addEventListener('click', function () { location.reload(); });
    }
    return;
  }

  var profile = site.profile || {};
  var about = site.about || null;
  var projects = (site.projects && site.projects.items) || [];
  var posts = ((site.writing && site.writing.items) || []).slice().sort(function (a, b) {
    return String(b.date || '').localeCompare(String(a.date || ''));
  });
  var timeline = (site.timeline && site.timeline.items) || [];
  var contact = site.contact || null;
  var bodies = Object.create(null);

  /* ---------- 文章正文预取 ---------- */
  function loadPosts() {
    return Promise.all(posts.map(function (post) {
      var url = 'content/posts/' + encodeURIComponent(post.slug) + '.md';
      return fetch(url, { cache: 'no-cache' })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.text();
        })
        .then(function (text) {
          bodies[post.slug] = text;
          post.reading = MD.readingTime(text);
        })
        .catch(function () {
          bodies[post.slug] = '';
          post.reading = null;
        });
    }));
  }

  /* ---------- 导航 ---------- */
  var sections = [];

  function buildNav() {
    var nav = $('#nav');
    var mobile = $('#mobile-nav-links');
    if (nav) {
      nav.innerHTML = sections.map(function (section) {
        return '<a href="#' + section.id + '" data-nav="' + section.id + '">' + esc(section.label) + '</a>';
      }).join('');
    }
    if (mobile) {
      mobile.innerHTML = sections.map(function (section, index) {
        return '<a href="#' + section.id + '">' + esc(section.label) +
          '<span>' + String(index + 1).padStart(2, '0') + '</span></a>';
      }).join('');
    }
    var foot = $('#mobile-nav-foot');
    if (foot) foot.innerHTML = socialsHtml();
  }

  function socialsHtml() {
    return ((profile.socials) || []).map(function (social) {
      return '<a class="social" href="' + esc(social.url) + '"' + externalAttr(social.url) + '>' +
        icon(social.icon || 'link') + '<span>' + esc(social.label) + '</span></a>';
    }).join('');
  }

  /* ---------- 渲染 ---------- */
  function renderHero() {
    var stats = computeStats();
    var actions = '';
    if (projects.length) {
      actions += '<a class="btn btn-primary" href="#work">查看项目 ' + icon('arrowUpRight') + '</a>';
    }
    if (posts.length) {
      actions += '<a class="btn btn-ghost" href="#writing">读点文字 ' + icon('arrowRight') + '</a>';
    }

    var meta = [];
    if (profile.availability) {
      meta.push('<span class="status"><i aria-hidden="true"></i>' + esc(profile.availability) + '</span>');
    }
    if (profile.location) {
      if (meta.length) meta.push('<span class="sep" aria-hidden="true">/</span>');
      meta.push('<span>' + esc(profile.location) + '</span>');
    }

    var figure = '';
    if (profile.avatar) {
      figure = '<div class="hero-figure" data-reveal style="--delay:5">' +
        '<figure class="portrait">' +
          '<img src="' + esc(profile.avatar) + '" alt="' + esc(profile.avatarAlt || profile.name) + '" width="480" height="600" fetchpriority="high" decoding="async">' +
        '</figure>' +
      '</div>';
    }

    var statsHtml = '';
    if (stats.length) {
      statsHtml = '<div class="hero-stats" data-reveal style="--delay:6">' + stats.map(function (stat) {
        return '<div class="stat"><span class="stat-value">' + esc(stat.value) +
          (stat.suffix ? '<sup>' + esc(stat.suffix) + '</sup>' : '') +
          '</span><span class="stat-label">' + esc(stat.label) + '</span></div>';
      }).join('') + '</div>';
    }

    return '<section class="hero" aria-labelledby="hero-title">' +
      '<div class="hero-inner">' +
        '<div class="hero-copy">' +
          '<p class="eyebrow" data-reveal><span class="en">' + esc(profile.eyebrowEn || 'HELLO, I AM') + '</span>' +
            (profile.eyebrow ? '<span class="cn">' + esc(profile.eyebrow) + '</span>' : '') + '</p>' +
          '<h1 class="hero-name" id="hero-title" data-reveal style="--delay:1">' + esc(profile.name) +
            '<span class="dot" aria-hidden="true">.</span></h1>' +
          (profile.role ? '<p class="hero-role" data-reveal style="--delay:2">' + esc(profile.role) + '</p>' : '') +
          (profile.tagline ? '<p class="hero-tagline" data-reveal style="--delay:3">' + esc(profile.tagline) + '</p>' : '') +
          (profile.intro ? '<p class="hero-intro" data-reveal style="--delay:4">' + esc(profile.intro) + '</p>' : '') +
          (actions ? '<div class="hero-actions" data-reveal style="--delay:5">' + actions + '</div>' : '') +
          (meta.length ? '<div class="hero-meta" data-reveal style="--delay:6">' + meta.join('') + '</div>' : '') +
        '</div>' +
        figure +
      '</div>' + statsHtml +
    '</section>';
  }

  function computeStats() {
    if (Array.isArray(site.stats) && site.stats.length) {
      return site.stats.slice(0, 3).map(function (item) {
        return { value: item.value, suffix: item.suffix || '', label: item.label || '' };
      });
    }
    var result = [];
    var start = parseInt(profile.careerStart, 10);
    var year = new Date().getFullYear();
    if (start && year > start) {
      result.push({ value: year - start, suffix: '年', label: '设计与开发经验' });
    }
    if (projects.length) result.push({ value: projects.length, suffix: '', label: '个公开项目' });
    if (posts.length) result.push({ value: posts.length, suffix: '篇', label: '公开写作' });
    return result.slice(0, 3);
  }

  function sectionHead(number, id, label, en, title, note) {
    return '<header class="section-head" data-reveal>' +
      '<p class="section-kicker"><span class="num">' + String(number).padStart(2, '0') + '</span>' +
        '<span class="line" aria-hidden="true"></span><span>' + esc(en || '') + ' / ' + esc(label) + '</span></p>' +
      '<div>' +
        '<h2 class="section-title" id="' + id + '-title">' + esc(title) + '</h2>' +
        (note ? '<p class="section-note">' + esc(note) + '</p>' : '') +
      '</div>' +
    '</header>';
  }

  function renderAbout(number) {
    if (!about || (!about.bio || !about.bio.length) && !(about.facts || []).length) return '';
    var bio = (about.bio || []).map(function (paragraph) { return '<p>' + esc(paragraph) + '</p>'; }).join('');
    var skills = (about.skills || []).length ?
      '<div class="skills"><p class="sub-label">常用技能 / TOOLKIT</p><div class="skills-list">' +
        about.skills.map(function (skill) { return '<span class="chip">' + esc(skill) + '</span>'; }).join('') +
      '</div></div>' : '';
    var facts = (about.facts || []).length ?
      '<aside class="about-facts" data-reveal style="--delay:2">' +
        '<p class="facts-title">Quick facts</p>' +
        '<dl class="facts-list">' + about.facts.map(function (fact) {
          return '<div class="fact"><dt>' + esc(fact.k) + '</dt><dd>' + esc(fact.v) + '</dd></div>';
        }).join('') + '</dl>' +
      '</aside>' : '';

    sections.push({ id: 'about', label: about.label || '关于' });
    return '<section class="section" id="about" aria-labelledby="about-title">' +
      sectionHead(number, 'about', about.label || '关于', about.en || 'ABOUT', about.title || '关于我') +
      '<div class="about-grid' + (facts ? '' : ' is-single') + '">' +
        '<div class="about-bio" data-reveal>' + bio + skills + '</div>' +
        facts +
      '</div>' +
    '</section>';
  }

  function renderProjects(number) {
    if (!projects.length) return '';
    var rows = projects.map(function (project) {
      var tags = (project.tags || []).length ?
        '<div class="project-tags">' + project.tags.map(function (tag) {
          return '<span class="tag">' + esc(tag) + '</span>';
        }).join('') + '</div>' : '';
      var body = '<div class="project-body">' +
        '<div class="project-head">' +
          '<h3 class="project-title">' + esc(project.title) + '</h3>' +
          (project.en ? '<span class="project-en">' + esc(project.en) + '</span>' : '') +
          (project.year ? '<span class="project-year">' + esc(project.year) + '</span>' : '') +
        '</div>' +
        (project.description ? '<p class="project-desc">' + esc(project.description) + '</p>' : '') +
        tags +
      '</div>';
      var arrow = '<span class="project-arrow" aria-hidden="true">' + icon('arrowUpRight') + '</span>';
      if (project.url) {
        return '<a class="project" href="' + esc(project.url) + '"' + externalAttr(project.url) + '>' + body + arrow + '</a>';
      }
      return '<div class="project no-link">' + body + arrow + '</div>';
    }).join('');

    sections.push({ id: 'work', label: site.projects.label || '项目' });
    return '<section class="section" id="work" aria-labelledby="work-title">' +
      sectionHead(number, 'work', site.projects.label || '项目', site.projects.en || 'WORK',
        site.projects.title || '做过的一些东西。', site.projects.note) +
      '<div class="project-list" data-reveal>' + rows + '</div>' +
    '</section>';
  }

  function renderResume(number) {
    var resume = site.resume;
    if (!resume || !(resume.items || []).length) return '';

    var cards = resume.items.map(function (item, index) {
      var tags = (item.tags || []).length ?
        '<div class="resume-tags">' + item.tags.map(function (tag) {
          return '<span class="tag">' + esc(tag) + '</span>';
        }).join('') + '</div>' : '';

      var actions = '';
      if (item.pdf) {
        actions += '<a class="btn btn-primary btn-sm" href="' + esc(item.pdf) +
          '" target="_blank" rel="noopener">在线预览 PDF' + icon('arrowUpRight') + '</a>';
      }
      if (item.docx) {
        actions += '<a class="btn btn-ghost btn-sm" href="' + esc(item.docx) +
          '" download>下载 DOCX' + icon('download') + '</a>';
      }
      if (item.pdf) {
        actions += '<a class="resume-download" href="' + esc(item.pdf) + '" download>下载 PDF</a>';
      }
      if (!actions) {
        actions = '<span class="resume-files">文件准备中</span>';
      }

      return '<article class="resume-card" data-reveal style="--delay:' + Math.min(index, 3) + '">' +
        '<div class="resume-card-top">' +
          '<span class="resume-index">' + String(index + 1).padStart(2, '0') + '</span>' +
          '<span class="resume-badge">' + esc(item.badge || 'RESUME') + '</span>' +
        '</div>' +
        '<h3 class="resume-title">' + esc(item.title) + '</h3>' +
        (item.subtitle ? '<p class="resume-subtitle">' + esc(item.subtitle) + '</p>' : '') +
        (item.summary ? '<p class="resume-summary">' + esc(item.summary) + '</p>' : '') +
        tags +
        '<div class="resume-files">PDF 可在线预览 · DOCX 可下载修改</div>' +
        '<div class="resume-actions">' + actions + '</div>' +
      '</article>';
    }).join('');

    sections.push({ id: 'resume', label: resume.label || '简历' });
    return '<section class="section" id="resume" aria-labelledby="resume-title">' +
      sectionHead(number, 'resume', resume.label || '简历', resume.en || 'RESUME',
        resume.title || '简历', resume.note) +
      '<div class="resume-grid">' + cards + '</div>' +
    '</section>';
  }

  function renderWriting(number) {
    if (!posts.length) return '';
    var visible = 6;
    var rows = posts.map(function (post) {
      return '<button class="post-row" type="button" data-slug="' + esc(post.slug) + '">' +
        '<span class="post-date">' + esc(fmtDot(post.date)) + '</span>' +
        '<span class="post-body">' +
          '<span class="post-title">' + esc(post.title) + '</span>' +
          (post.summary ? '<span class="post-summary">' + esc(post.summary) + '</span>' : '') +
        '</span>' +
        '<span class="post-read">' + (post.reading ? post.reading + ' 分钟' : '—') + '</span>' +
      '</button>';
    }).join('');

    var more = posts.length > visible ?
      '<div class="post-more"><button class="btn btn-ghost" id="post-more" type="button">查看全部 ' +
        posts.length + ' 篇' + icon('arrowRight') + '</button></div>' : '';

    sections.push({ id: 'writing', label: site.writing.label || '文章' });
    return '<section class="section" id="writing" aria-labelledby="writing-title">' +
      sectionHead(number, 'writing', site.writing.label || '文章', site.writing.en || 'WRITING',
        site.writing.title || '写下来，才算想清楚。', site.writing.note) +
      '<div class="post-list' + (posts.length > visible ? '' : ' is-expanded') + '" data-reveal>' + rows + '</div>' +
      more +
    '</section>';
  }

  function renderTimeline(number) {
    if (!timeline.length) return '';
    var rows = timeline.map(function (item) {
      return '<div class="timeline-item' + (item.current ? ' is-current' : '') + '">' +
        '<p class="timeline-period">' + esc(item.period) + '</p>' +
        '<div><h3 class="timeline-title">' + esc(item.title) + '</h3>' +
          (item.description ? '<p class="timeline-desc">' + esc(item.description) + '</p>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    sections.push({ id: 'timeline', label: site.timeline.label || '经历' });
    return '<section class="section" id="timeline" aria-labelledby="timeline-title">' +
      sectionHead(number, 'timeline', site.timeline.label || '经历', site.timeline.en || 'PATH',
        site.timeline.title || '一路走来。') +
      '<div class="timeline" data-reveal>' + rows + '</div>' +
    '</section>';
  }

  function renderContact(number) {
    if (!contact) return '';
    var email = profile.email || '';
    sections.push({ id: 'contact', label: contact.label || '联系' });
    return '<section class="section section-contact" id="contact" aria-labelledby="contact-title">' +
      '<p class="section-kicker" data-reveal><span class="num">' + String(number).padStart(2, '0') + '</span>' +
        '<span class="line" aria-hidden="true"></span><span>' + esc(contact.en || 'CONTACT') + ' / ' + esc(contact.label || '联系') + '</span></p>' +
      '<div class="contact-panel" data-reveal style="--delay:1">' +
        '<div class="contact-main">' +
          '<h2 class="contact-title" id="contact-title">' + esc(contact.title || '一起做点有趣的事。') + '</h2>' +
          (contact.text ? '<p class="contact-text">' + esc(contact.text) + '</p>' : '') +
          '<div class="contact-actions">' +
            (email ? '<a class="btn btn-primary" href="mailto:' + esc(email) + '">' + icon('mail') + esc(contact.emailButton || '写信给我') + '</a>' : '') +
            (email ? '<button class="btn btn-ghost" id="copy-email" type="button" data-email="' + esc(email) + '">' + icon('copy') + esc(contact.copyButton || '复制邮箱') + '</button>' : '') +
          '</div>' +
          (email ? '<p class="contact-note">' + esc(email) + (contact.note ? ' · ' + esc(contact.note) : '') + '</p>' : '') +
        '</div>' +
        '<aside class="contact-side">' +
          '<p class="contact-side-title">ELSEWHERE / 在这些地方</p>' +
          '<div class="socials">' + socialsHtml() + '</div>' +
        '</aside>' +
      '</div>' +
    '</section>';
  }

  function renderFooter() {
    var footer = site.footer || {};
    $('#footer-year').textContent = String(new Date().getFullYear());
    $('#footer-name').textContent = footer.copyright || profile.name || '';
    $('#footer-note').textContent = footer.note || '';
  }

  function renderSite() {
    var html = renderHero();
    html += renderAbout(sections.length + 1);
    html += renderProjects(sections.length + 1);
    html += renderResume(sections.length + 1);
    html += renderWriting(sections.length + 1);
    html += renderTimeline(sections.length + 1);
    html += renderContact(sections.length + 1);
    $('#main').innerHTML = html;

    var brandMark = $('.brand-mark');
    if (brandMark) brandMark.textContent = profile.mark || String(profile.name || '·').charAt(0);
    var brandName = $('.brand-text strong');
    if (brandName) brandName.textContent = profile.name || '';
    var brandLatin = $('.brand-text small');
    if (brandLatin) brandLatin.textContent = profile.latin || '';

    renderFooter();
    buildNav();
    buildPaletteItems();
    syncMeta();
    bindContent();
    activateReveal();
    activateScrollSpy();
  }

  function syncMeta() {
    var meta = site.meta || {};
    if (meta.title) doc.title = meta.title;
    if (meta.description) {
      var description = $('meta[name="description"]');
      if (description) description.setAttribute('content', meta.description);
    }
    var ogTitle = $('meta[property="og:title"]');
    if (ogTitle && meta.title) ogTitle.setAttribute('content', meta.title);
    var ogDesc = $('meta[property="og:description"]');
    if (ogDesc && meta.description) ogDesc.setAttribute('content', meta.description);
  }

  function bindContent() {
    $('#main').addEventListener('click', function (event) {
      var postRow = event.target.closest('[data-slug]');
      if (postRow) {
        openPost(postRow.getAttribute('data-slug'));
        return;
      }
      if (event.target.closest('#post-more')) {
        var list = $('.post-list');
        var button = $('#post-more');
        if (!list) return;
        if (list.classList.toggle('is-expanded')) {
          button.innerHTML = '收起' + icon('arrowRight');
        } else {
          button.innerHTML = '查看全部 ' + posts.length + ' 篇' + icon('arrowRight');
        }
        return;
      }
      if (event.target.closest('#copy-email')) {
        var email = event.target.closest('#copy-email').getAttribute('data-email');
        copyText(email).then(function () { toast('邮箱已复制：' + email); });
      }
    });
  }

  /* ---------- 观察器：滚动进入 / 导航高亮 ---------- */
  var revealObserver = null;
  function activateReveal() {
    var elements = $$('[data-reveal]');
    if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      elements.forEach(function (element) { element.classList.add('is-in'); });
      return;
    }
    if (!revealObserver) {
      root.classList.add('has-reveal');
      revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          revealObserver.unobserve(entry.target);
        });
      }, { threshold: 0.06, rootMargin: '0px 0px -6% 0px' });

      // 兜底：无论如何都在 1.8 秒内显示内容，避免动画抢走可读性
      setTimeout(function () {
        $$('[data-reveal]').forEach(function (element) { element.classList.add('is-in'); });
      }, 1800);
    }
    elements.forEach(function (element) { revealObserver.observe(element); });
  }

  function activateScrollSpy() {
    if (!('IntersectionObserver' in window)) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        $$('#nav a').forEach(function (link) {
          if (link.getAttribute('data-nav') === entry.target.id) {
            link.setAttribute('aria-current', 'true');
          } else {
            link.removeAttribute('aria-current');
          }
        });
      });
    }, { rootMargin: '-42% 0px -52% 0px', threshold: 0 });
    sections.forEach(function (section) {
      var element = doc.getElementById(section.id);
      if (element) observer.observe(element);
    });
  }

  /* ---------- 阅读层 ---------- */
  var reader = $('#reader');
  var readerScroll = $('#reader-scroll');
  var currentSlug = null;
  var lastFocus = null;
  var closeTimer = null;

  function openPost(slug, options) {
    options = options || {};
    var post = posts.filter(function (item) { return item.slug === slug; })[0];
    if (!post) return;
    clearTimeout(closeTimer);
    currentSlug = slug;
    lastFocus = doc.activeElement;

    $('#reader-title').textContent = post.title;
    $('#reader-bar-title').textContent = post.title;
    $('#reader-kicker').textContent = (post.tags || []).join(' · ');
    $('#reader-summary').textContent = post.summary || '';
    $('#reader-info').innerHTML =
      '<span>' + esc(fmtLong(post.date)) + '</span>' +
      '<span>' + (post.reading || 1) + ' 分钟阅读</span>' +
      ((post.tags || []).length ? '<span>' + esc(post.tags.join(' / ')) + '</span>' : '');

    var body = bodies[post.slug];
    if (body) {
      $('#reader-body').innerHTML = MD.render(body);
      attachCodeCopy();
    } else {
      $('#reader-body').innerHTML = '<p>正文读取不到。请确认 <code>content/posts/' + esc(post.slug) +
        '.md</code> 存在，并通过本地服务器（start.cmd）打开本站。</p>';
    }

    renderReaderNav(post);
    reader.hidden = false;
    readerScroll.scrollTop = 0;
    root.classList.add('is-locked');
    requestAnimationFrame(function () { reader.classList.add('is-open'); });
    updateReaderProgress();

    if (options.push !== false && location.hash !== '#/writing/' + slug) {
      history.pushState({ post: slug }, '', '#/writing/' + slug);
    }
    doc.title = post.title + ' · ' + (profile.name || '');

    setTimeout(function () {
      readerScroll.focus({ preventScroll: true });
    }, 80);
  }

  function closeReader(options) {
    options = options || {};
    if (reader.hidden) return;
    reader.classList.remove('is-open');
    root.classList.remove('is-locked');
    currentSlug = null;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () { reader.hidden = true; }, 320);
    if (options.replace !== false && /^#\/writing\//.test(location.hash)) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (site.meta && site.meta.title) doc.title = site.meta.title;
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function renderReaderNav(post) {
    var index = posts.indexOf(post);
    var newer = posts[index - 1];
    var older = posts[index + 1];
    var html = '';
    if (newer) {
      html += '<button type="button" data-open-post="' + esc(newer.slug) + '">' +
        '<span class="dir">← 更新的一篇</span><span class="name">' + esc(newer.title) + '</span></button>';
    }
    if (older) {
      html += '<button type="button" class="next" data-open-post="' + esc(older.slug) + '">' +
        '<span class="dir">更早的一篇 →</span><span class="name">' + esc(older.title) + '</span></button>';
    }
    var nav = $('#reader-nav');
    nav.innerHTML = html;
    nav.classList.toggle('is-single', !(newer && older));
    if (!newer && !older) nav.style.gridTemplateColumns = '1fr';
    else nav.style.gridTemplateColumns = '';
  }

  function updateReaderProgress() {
    var max = readerScroll.scrollHeight - readerScroll.clientHeight;
    var value = max > 0 ? readerScroll.scrollTop / max : 0;
    var bar = $('#reader-progress-bar');
    if (bar) bar.style.transform = 'scaleX(' + Math.min(1, Math.max(0, value)) + ')';
  }

  function attachCodeCopy() {
    $$('#reader-body .code-copy').forEach(function (button) {
      if (button.dataset.bound) return;
      button.dataset.bound = '1';
      button.addEventListener('click', function () {
        var block = button.closest('.codeblock');
        var pre = block && block.querySelector('pre');
        if (!pre) return;
        copyText(pre.innerText).then(function () {
          button.textContent = '已复制';
          setTimeout(function () { button.textContent = '复制'; }, 1600);
        });
      });
    });
  }

  reader.addEventListener('click', function (event) {
    if (event.target.closest('#reader-close')) {
      closeReader();
      return;
    }
    var jump = event.target.closest('[data-open-post]');
    if (jump) openPost(jump.getAttribute('data-open-post'));
  });

  readerScroll.addEventListener('scroll', function () {
    var ticking = false;
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      updateReaderProgress();
      ticking = false;
    });
  }, { passive: true });

  /* ---------- 路由 ---------- */
  function route() {
    var match = /^#\/writing\/([^/?#]+)$/.exec(location.hash);
    if (match) {
      var slug = decodeURIComponent(match[1]);
      if (currentSlug !== slug) openPost(slug, { push: false });
    } else if (currentSlug) {
      closeReader({ replace: false });
    }
  }
  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);

  /* ---------- 命令面板 ---------- */
  var palette = $('#palette');
  var paletteInput = $('#palette-input');
  var paletteList = $('#palette-list');
  var paletteResults = [];
  var paletteIndex = 0;
  var paletteOpen = false;
  var paletteItems = [];

  function buildPaletteItems() {
    paletteItems = [];
    sections.forEach(function (section) {
      paletteItems.push({
        type: '跳转', label: section.label, hint: '#' + section.id,
        action: function () { scrollToSection(section.id); }
      });
    });
    posts.forEach(function (post) {
      paletteItems.push({
        type: '文章', label: post.title, hint: fmtDot(post.date),
        keywords: (post.tags || []).join(' ') + ' ' + (post.summary || ''),
        action: function () { openPost(post.slug); }
      });
    });
    ((profile.socials) || []).forEach(function (social) {
      paletteItems.push({
        type: '链接', label: social.label, hint: (function () {
          try { return new URL(social.url, location.href).hostname.replace(/^www\./, ''); }
          catch (error) { return ''; }
        })(),
        action: function () { window.open(social.url, externalAttr(social.url) ? '_blank' : '_self'); }
      });
    });
    paletteItems.push({
      type: '操作', label: '切换深色 / 浅色模式', hint: '主题',
      action: function () { toggleTheme(); }
    });
    if (profile.email) {
      paletteItems.push({
        type: '操作', label: '复制邮箱地址', hint: profile.email,
        action: function () { copyText(profile.email).then(function () { toast('邮箱已复制'); }); }
      });
    }
    // 编辑器只在本机开发时出现，公开站点不暴露入口
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      paletteItems.push({
        type: '操作', label: '打开内容编辑器', hint: 'admin.html',
        action: function () { location.href = 'admin.html'; }
      });
    }
  }

  function scrollToSection(id) {
    if (currentSlug) closeReader();
    var target = doc.getElementById(id);
    if (target) {
      window.requestAnimationFrame(function () {
        target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      });
    }
  }

  function filterPalette() {
    var query = paletteInput.value.trim().toLowerCase();
    if (!query) return paletteItems.slice();
    return paletteItems.filter(function (item) {
      return (item.label + ' ' + item.type + ' ' + (item.hint || '') + ' ' + (item.keywords || ''))
        .toLowerCase().indexOf(query) !== -1;
    });
  }

  function renderPalette() {
    paletteResults = filterPalette();
    paletteIndex = Math.min(paletteIndex, Math.max(0, paletteResults.length - 1));
    if (!paletteResults.length) {
      paletteList.innerHTML = '<li class="palette-empty">没有找到相关内容</li>';
      return;
    }
    paletteList.innerHTML = paletteResults.map(function (item, index) {
      return '<li role="presentation"><button type="button" class="palette-item" role="option" data-index="' + index + '"' +
        ' aria-selected="' + (index === paletteIndex ? 'true' : 'false') + '">' +
        '<span class="type">' + esc(item.type) + '</span>' +
        '<span class="label">' + esc(item.label) + '</span>' +
        (item.hint ? '<span class="hint">' + esc(item.hint) + '</span>' : '') +
      '</button></li>';
    }).join('');
    var active = paletteList.querySelector('[aria-selected="true"]');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function openPalette() {
    if (paletteOpen) return;
    paletteOpen = true;
    palette.hidden = false;
    paletteInput.value = '';
    paletteIndex = 0;
    renderPalette();
    root.classList.add('is-locked');
    setTimeout(function () { paletteInput.focus(); }, 30);
  }

  function closePalette() {
    if (!paletteOpen) return;
    paletteOpen = false;
    palette.hidden = true;
    if (!currentSlug) root.classList.remove('is-locked');
    var search = $('#search-btn');
    if (search) search.focus({ preventScroll: true });
  }

  function runPalette(index) {
    var item = paletteResults[index];
    if (!item) return;
    closePalette();
    item.action();
  }

  palette.addEventListener('click', function (event) {
    if (event.target.closest('[data-palette-close]')) {
      closePalette();
      return;
    }
    var option = event.target.closest('[data-index]');
    if (option) runPalette(Number(option.getAttribute('data-index')));
  });

  paletteInput.addEventListener('input', function () {
    paletteIndex = 0;
    renderPalette();
  });

  palette.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      paletteIndex = Math.min(paletteResults.length - 1, paletteIndex + 1);
      renderPalette();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      paletteIndex = Math.max(0, paletteIndex - 1);
      renderPalette();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runPalette(paletteIndex);
    }
  });

  /* ---------- 主题 / 菜单 / 全局事件 ---------- */
  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (error) { /* 忽略 */ }
    var meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0d0f11' : '#f8f6f1');
  }
  function toggleTheme() {
    applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }

  var menuBtn = $('#menu-btn');
  var mobileNav = $('#mobile-nav');
  var menuIcon = menuBtn ? menuBtn.innerHTML : '';
  function openMenu() {
    mobileNav.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
    menuBtn.setAttribute('aria-label', '关闭菜单');
    menuBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + PATHS.x + '</svg>';
    root.classList.add('is-locked');
  }
  function closeMenu() {
    if (mobileNav.hidden) return;
    mobileNav.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-label', '打开菜单');
    menuBtn.innerHTML = menuIcon;
    if (!currentSlug) root.classList.remove('is-locked');
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      if (mobileNav.hidden) openMenu(); else closeMenu();
    });
  }
  if (mobileNav) {
    mobileNav.addEventListener('click', function (event) {
      if (event.target.closest('a')) closeMenu();
    });
  }
  var themeBtn = $('#theme-btn');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  var searchBtn = $('#search-btn');
  if (searchBtn) searchBtn.addEventListener('click', openPalette);

  doc.addEventListener('keydown', function (event) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((event.target.tagName || '')) || event.target.isContentEditable;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (paletteOpen) closePalette(); else openPalette();
      return;
    }
    if (event.key === 'Escape') {
      if (paletteOpen) { closePalette(); return; }
      if (!mobileNav.hidden) { closeMenu(); return; }
      if (currentSlug) { closeReader(); return; }
    }
    if (event.key === '/' && !typing && !paletteOpen && !currentSlug) {
      event.preventDefault();
      openPalette();
    }
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 980) closeMenu();
  });

  /* ---------- 滚动 ---------- */
  var header = $('#site-header');
  var scrollBar = $('#scroll-bar');
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY || window.pageYOffset;
      if (header) header.classList.toggle('is-scrolled', y > 6);
      var max = root.scrollHeight - window.innerHeight;
      if (scrollBar) {
        scrollBar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';
      }
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- 启动 ---------- */
  loadPosts().then(function () {
    renderSite();
    onScroll();
    if (location.protocol === 'file:') {
      toast('以文件方式打开时，文章正文可能无法加载，建议运行 start.cmd');
    }
    var boot = $('#boot');
    if (boot) {
      boot.classList.add('is-done');
      setTimeout(function () { boot.remove(); }, 500);
    }
    route();
  });
})();