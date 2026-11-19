/* ==========================================================================
   内容编辑器
   · 读取 /api/content，保存 /api/save（由 server.mjs 提供）
   · 保存时会写回 content/site.js 和 content/posts/*.md
   ========================================================================= */
(function () {
  'use strict';

  var state = {
    site: null,
    bodies: Object.create(null),
    postIndex: 0,
    removed: [],
    dirty: false,
    saving: false,
    loaded: false,
    rawTouched: false
  };

  var MD = window.Markdown;
  var doc = document;

  function $(selector) { return doc.querySelector(selector); }
  function $$(selector) { return Array.prototype.slice.call(doc.querySelectorAll(selector)); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function pad(number) { return String(number).padStart(2, '0'); }
  function today() {
    var date = new Date();
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
  function timeNow() {
    var date = new Date();
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }
  function splitList(value) {
    return String(value || '').split(/[,，]/).map(function (item) { return item.trim(); }).filter(Boolean);
  }
  function splitLines(value) {
    return String(value || '').split(/\n+/).map(function (item) { return item.trim(); }).filter(Boolean);
  }

  function getPath(object, path) {
    return path.split('.').reduce(function (current, key) {
      return current == null ? undefined : current[key];
    }, object);
  }
  function setPath(object, path, value) {
    var keys = path.split('.');
    var last = keys.pop();
    var target = keys.reduce(function (current, key) {
      if (current[key] == null || typeof current[key] !== 'object') current[key] = {};
      return current[key];
    }, object);
    target[last] = value;
  }

  var els = {
    status: $('#save-state'),
    save: $('#btn-save'),
    backup: $('#btn-backup'),
    importFile: $('#import-file'),
    errors: $('#form-errors'),
    blocked: $('#blocked'),
    blockedDetail: $('#blocked-detail'),
    raw: $('#raw-json')
  };

  var toastTimer = null;
  function toast(message) {
    var el = $('#admin-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function setStatus(text, kind) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.className = 'save-state' + (kind ? ' is-' + kind : '');
  }

  function markDirty() {
    if (!state.loaded) return;
    state.dirty = true;
    setStatus('有未保存的更改', 'dirty');
  }

  function showErrors(errors) {
    if (!els.errors) return;
    els.errors.innerHTML = '<strong>还需要处理：</strong><ul>' + errors.map(function (error) {
      return '<li>' + esc(error) + '</li>';
    }).join('') + '</ul>';
    els.errors.hidden = false;
    els.errors.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function hideErrors() {
    if (els.errors) {
      els.errors.hidden = true;
      els.errors.innerHTML = '';
    }
  }

  /* ---------- 数据整理 ---------- */
  function normalize(site) {
    site.profile = site.profile || {};
    site.meta = site.meta || {};
    site.about = site.about || {};
    site.projects = site.projects || {};
    site.resume = site.resume || {};
    site.writing = site.writing || {};
    site.timeline = site.timeline || {};
    site.contact = site.contact || {};
    site.footer = site.footer || {};
    site.profile.socials = site.profile.socials || [];
    site.about.bio = site.about.bio || [];
    site.about.facts = site.about.facts || [];
    site.about.skills = site.about.skills || [];
    site.projects.items = site.projects.items || [];
    site.resume.items = site.resume.items || [];
    site.writing.items = site.writing.items || [];
    site.timeline.items = site.timeline.items || [];
    (site.writing.items || []).forEach(function (post) {
      post.tags = post.tags || [];
      post.slug = String(post.slug || '');
    });
    return site;
  }

  function getList(kind) {
    if (kind === 'socials') return state.site.profile.socials;
    if (kind === 'facts') return state.site.about.facts;
    if (kind === 'projects') return state.site.projects.items;
    if (kind === 'resume') return state.site.resume.items;
    if (kind === 'timeline') return state.site.timeline.items;
    return [];
  }

  /* ---------- 静态字段 ---------- */
  function fillStatic() {
    $$('[data-path]').forEach(function (element) {
      var value = getPath(state.site, element.getAttribute('data-path'));
      var format = element.getAttribute('data-format');
      if (format === 'lines' && Array.isArray(value)) value = value.join('\n');
      else if (format === 'list' && Array.isArray(value)) value = value.join(', ');
      if (element.type === 'checkbox') element.checked = Boolean(value);
      else element.value = value == null ? '' : value;
    });
  }

  function onFieldInput(event) {
    var element = event.target;

    // 静态字段
    if (element.matches('[data-path]')) {
      var path = element.getAttribute('data-path');
      var value = element.type === 'checkbox' ? element.checked : element.value;
      var format = element.getAttribute('data-format');
      if (format === 'lines') value = splitLines(value);
      else if (format === 'list') value = splitList(value);
      setPath(state.site, path, value);
      markDirty();
      return;
    }

    // 文章字段
    var postField = element.getAttribute('data-post-field');
    if (postField) {
      var post = state.site.writing.items[state.postIndex];
      if (!post) return;
      if (postField === 'slug') return; // slug 在 change 时处理
      if (postField === 'body') {
        state.bodies[post.slug] = element.value;
        var preview = $('#post-preview');
        if (preview && !preview.hidden) preview.innerHTML = MD.render(element.value);
      } else if (postField === 'tags') {
        post.tags = splitList(element.value);
      } else {
        post[postField] = element.value;
      }
      markDirty();
      if (postField === 'title') renderPostList();
      return;
    }

    // 可重复列表
    var card = element.closest('[data-item]');
    if (card) {
      var list = getList(card.getAttribute('data-item'));
      var index = Number(card.getAttribute('data-index'));
      var field = element.getAttribute('data-field');
      if (!list[index] || !field) return;
      var nextValue = element.type === 'checkbox' ? element.checked : element.value;
      if (field === 'tags') nextValue = splitList(element.value);
      list[index][field] = nextValue;
      markDirty();
    }
  }

  /* ---------- 可重复列表 ---------- */
  function actions(index, length) {
    return '<div class="card-actions">' +
      '<button class="mini" type="button" data-action="up"' + (index === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button class="mini" type="button" data-action="down"' + (index === length - 1 ? ' disabled' : '') + '>↓</button>' +
      '<button class="mini danger" type="button" data-action="remove">删除</button>' +
    '</div>';
  }

  function inputField(label, field, value, placeholder) {
    return '<label class="field"><span class="field-label">' + esc(label) + '</span>' +
      '<input class="input" data-field="' + field + '" value="' + esc(value) +
      '"' + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '></label>';
  }
  function textareaField(label, field, value, rows) {
    return '<label class="field"><span class="field-label">' + esc(label) + '</span>' +
      '<textarea class="textarea" data-field="' + field + '" rows="' + (rows || 2) + '">' + esc(value) + '</textarea></label>';
  }
  function selectField(label, field, value, options) {
    return '<label class="field"><span class="field-label">' + esc(label) + '</span>' +
      '<select class="select" data-field="' + field + '">' +
        options.map(function (option) {
          return '<option value="' + esc(option) + '"' + (option === value ? ' selected' : '') + '>' + esc(option) + '</option>';
        }).join('') +
      '</select></label>';
  }

  function renderSocials() {
    var items = state.site.profile.socials;
    var container = $('#socials');
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<p class="empty-hint">还没有社交链接，点“添加”加一个。</p>';
      return;
    }
    container.innerHTML = items.map(function (social, index) {
      return '<div class="card" data-item="socials" data-index="' + index + '">' +
        '<div class="card-head"><span class="card-title">链接 ' + (index + 1) + '</span>' + actions(index, items.length) + '</div>' +
        '<div class="grid-2">' +
          inputField('名称', 'label', social.label, 'GitHub') +
          selectField('图标', 'icon', social.icon || 'link', ['github', 'x', 'link', 'mail', 'phone']) +
        '</div>' +
        inputField('网址', 'url', social.url, 'https://…') +
      '</div>';
    }).join('');
  }

  function renderFacts() {
    var items = state.site.about.facts;
    var container = $('#facts');
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<p class="empty-hint">还没有快速信息。</p>';
      return;
    }
    container.innerHTML = items.map(function (fact, index) {
      return '<div class="card" data-item="facts" data-index="' + index + '">' +
        '<div class="card-head"><span class="card-title">信息 ' + (index + 1) + '</span>' + actions(index, items.length) + '</div>' +
        '<div class="grid-2">' +
          inputField('名称', 'k', fact.k, '现居') +
          inputField('内容', 'v', fact.v, '杭州 · 中国') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderProjects() {
    var items = state.site.projects.items;
    var container = $('#projects');
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<p class="empty-hint">还没有项目，点上面的“添加项目”。</p>';
      return;
    }
    container.innerHTML = items.map(function (project, index) {
      return '<div class="card" data-item="projects" data-index="' + index + '">' +
        '<div class="card-head"><span class="card-title">项目 ' + (index + 1) + '</span>' + actions(index, items.length) + '</div>' +
        '<div class="grid-2">' +
          inputField('名称', 'title', project.title, '飞机发动机拆装与维护') +
          inputField('英文名', 'en', project.en, 'Engine Maintenance') +
        '</div>' +
        '<div class="grid-2">' +
          inputField('年份', 'year', project.year, '2026') +
          inputField('链接', 'url', project.url, 'https://…') +
        '</div>' +
        textareaField('一句话描述', 'description', project.description, 2) +
        inputField('标签（逗号分隔）', 'tags', (project.tags || []).join(', '), '产品设计, Electron') +
      '</div>';
    }).join('');
  }

  function renderResumeItems() {
    var items = state.site.resume.items;
    var container = $('#resume');
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<p class="empty-hint">还没有简历文件，点上面的“添加”。</p>';
      return;
    }
    container.innerHTML = items.map(function (item, index) {
      return '<div class="card" data-item="resume" data-index="' + index + '">' +
        '<div class="card-head"><span class="card-title">简历 ' + (index + 1) + '</span>' + actions(index, items.length) + '</div>' +
        '<div class="grid-2">' +
          inputField('名称', 'title', item.title, '技术类简历') +
          inputField('英文标签', 'badge', item.badge, 'TECH') +
        '</div>' +
        inputField('目标岗位', 'subtitle', item.subtitle, '设备技术员 · 装配技术员') +
        textareaField('简介', 'summary', item.summary, 2) +
        inputField('标签（逗号分隔）', 'tags', (item.tags || []).join(', '), '设备维护, 质量检验') +
        '<div class="grid-2">' +
          inputField('DOCX 路径', 'docx', item.docx, 'assets/files/…docx') +
          inputField('PDF 路径', 'pdf', item.pdf, 'assets/files/…pdf') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderTimeline() {
    var items = state.site.timeline.items;
    var container = $('#timeline');
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<p class="empty-hint">还没有经历。</p>';
      return;
    }
    container.innerHTML = items.map(function (item, index) {
      return '<div class="card" data-item="timeline" data-index="' + index + '">' +
        '<div class="card-head"><span class="card-title">经历 ' + (index + 1) + '</span>' + actions(index, items.length) + '</div>' +
        '<div class="grid-2">' +
          inputField('时间', 'period', item.period, '2024 — 至今') +
          inputField('标题', 'title', item.title, '独立开发者 · 自由职业') +
        '</div>' +
        textareaField('描述', 'description', item.description, 2) +
        '<label class="check"><input type="checkbox" data-field="current"' + (item.current ? ' checked' : '') + '><span>这是当前正在进行的一段</span></label>' +
      '</div>';
    }).join('');
  }

  function renderAll() {
    fillStatic();
    renderSocials();
    renderFacts();
    renderProjects();
    renderResumeItems();
    renderTimeline();
    renderPostList();
    renderPostEditor();
  }

  /* ---------- 文章 ---------- */
  function renderPostList() {
    var items = state.site.writing.items;
    var container = $('#post-list');
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<p class="empty-hint">还没有文章。</p>';
      return;
    }
    container.innerHTML = items.map(function (post, index) {
      return '<button class="post-item' + (index === state.postIndex ? ' is-active' : '') +
        '" type="button" data-post-index="' + index + '">' +
        '<span class="post-item-title">' + esc(post.title || '未命名文章') + '</span>' +
        '<span class="post-item-date">' + esc(post.date || '') + '</span>' +
      '</button>';
    }).join('');
  }

  function renderPostEditor() {
    var container = $('#post-detail');
    if (!container) return;
    var items = state.site.writing.items;
    if (!items.length) {
      container.innerHTML = '<p class="post-empty">还没有文章，点“新文章”写第一篇。</p>';
      return;
    }
    state.postIndex = Math.max(0, Math.min(state.postIndex, items.length - 1));
    var post = items[state.postIndex];
    var body = state.bodies[post.slug] || '';
    container.innerHTML =
      '<div class="post-detail-head">' +
        '<span class="field-label">第 ' + (state.postIndex + 1) + ' / ' + items.length + ' 篇</span>' +
        '<div class="card-actions">' +
          '<button class="mini" type="button" data-action="toggle-preview" id="preview-toggle">预览 Markdown</button>' +
          '<button class="mini danger" type="button" data-action="delete-post">删除</button>' +
        '</div>' +
      '</div>' +
      '<label class="field"><span class="field-label">标题</span>' +
        '<input class="input" data-post-field="title" value="' + esc(post.title) + '" placeholder="文章标题"></label>' +
      '<div class="grid-2">' +
        '<label class="field"><span class="field-label">日期</span>' +
          '<input class="input" type="date" data-post-field="date" value="' + esc(post.date) + '"></label>' +
        '<label class="field"><span class="field-label">标签（逗号分隔）</span>' +
          '<input class="input" data-post-field="tags" value="' + esc((post.tags || []).join(', ')) + '"></label>' +
      '</div>' +
      '<label class="field"><span class="field-label">链接 slug（小写字母、数字、连字符）</span>' +
        '<input class="input" data-post-field="slug" value="' + esc(post.slug) + '" spellcheck="false">' +
        '<span class="hint">保存为 content/posts/' + esc(post.slug) + '.md，访问地址 #/writing/' + esc(post.slug) + '</span></label>' +
      '<label class="field"><span class="field-label">摘要</span>' +
        '<textarea class="textarea" data-post-field="summary" rows="2">' + esc(post.summary || '') + '</textarea></label>' +
      '<label class="field"><span class="field-label">正文（Markdown）</span>' +
        '<textarea class="textarea mono" data-post-field="body" rows="18" spellcheck="false">' + esc(body) + '</textarea></label>' +
      '<div class="markdown post-preview" id="post-preview" hidden></div>' +
      '<p class="hint">正文约 ' + body.length + ' 个字符 · 支持标题、列表、引用、代码块、链接和图片。</p>';
  }

  function selectPost(index) {
    state.postIndex = index;
    renderPostList();
    renderPostEditor();
  }

  function addPost() {
    var slug = 'post-' + Date.now().toString(36);
    var post = { slug: slug, title: '未命名文章', date: today(), summary: '', tags: [] };
    state.site.writing.items.push(post);
    state.bodies[slug] = '';
    selectPost(state.site.writing.items.length - 1);
    markDirty();
    var titleInput = $('[data-post-field="title"]');
    if (titleInput) {
      titleInput.focus();
      titleInput.select();
    }
    toast('已新建文章，记得改标题和 slug');
  }

  function deletePost() {
    var items = state.site.writing.items;
    var post = items[state.postIndex];
    if (!post) return;
    if (!window.confirm('确定删除《' + (post.title || '未命名文章') + '》吗？\n\n保存后，正文文件会被移到 content/posts/.trash，可以找回。')) return;
    state.removed.push(post.slug);
    delete state.bodies[post.slug];
    items.splice(state.postIndex, 1);
    state.postIndex = Math.max(0, state.postIndex - 1);
    renderPostList();
    renderPostEditor();
    markDirty();
    toast('已从列表移除，保存后生效');
  }

  function changeSlug(input) {
    var items = state.site.writing.items;
    var post = items[state.postIndex];
    if (!post) return;
    var next = String(input.value || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(next)) {
      toast('slug 只能用小写字母、数字和连字符');
      input.value = post.slug;
      return;
    }
    if (items.some(function (item, index) { return index !== state.postIndex && item.slug === next; })) {
      toast('这个 slug 已经被用了');
      input.value = post.slug;
      return;
    }
    if (next === post.slug) return;
    var body = state.bodies[post.slug] || '';
    delete state.bodies[post.slug];
    state.bodies[next] = body;
    post.slug = next;
    markDirty();
    renderPostList();
    renderPostEditor();
  }

  function togglePreview() {
    var preview = $('#post-preview');
    var button = $('#preview-toggle');
    if (!preview || !button) return;
    if (preview.hidden) {
      var post = state.site.writing.items[state.postIndex];
      preview.innerHTML = MD.render(state.bodies[post.slug] || '');
      preview.hidden = false;
      button.textContent = '收起预览';
    } else {
      preview.hidden = true;
      button.textContent = '预览 Markdown';
    }
  }

  /* ---------- 校验与保存 ---------- */
  function collectErrors() {
    var errors = [];
    var site = state.site;
    if (!String(site.profile.name || '').trim()) errors.push('名字不能为空');
    if (!String(site.meta.title || '').trim()) errors.push('浏览器标题不能为空');
    if (site.profile.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(site.profile.email)) {
      errors.push('邮箱格式看起来不太对');
    }
    var seen = {};
    site.writing.items.forEach(function (post, index) {
      var number = index + 1;
      if (!String(post.title || '').trim()) errors.push('第 ' + number + ' 篇文章缺少标题');
      if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(post.slug || '')) errors.push('第 ' + number + ' 篇文章的 slug 不合法');
      if (seen[post.slug]) errors.push('slug 重复：' + post.slug);
      seen[post.slug] = true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date || '')) errors.push('第 ' + number + ' 篇文章的日期格式应为 YYYY-MM-DD');
    });
    site.resume.items.forEach(function (item, index) {
      var number = index + 1;
      if (!String(item.title || '').trim()) errors.push('第 ' + number + ' 份简历缺少名称');
      if (!item.docx && !item.pdf) errors.push('第 ' + number + ' 份简历至少需要 DOCX 或 PDF 路径');
    });
    return errors;
  }

  async function save() {
    if (!state.site || state.saving) return;
    var errors = collectErrors();
    if (errors.length) {
      showErrors(errors);
      toast('还有 ' + errors.length + ' 处需要修改');
      return;
    }
    hideErrors();
    state.saving = true;
    setStatus('保存中…', '');
    try {
      var payload = {
        site: state.site,
        posts: state.site.writing.items.map(function (post) {
          return { slug: post.slug, body: state.bodies[post.slug] || '' };
        }),
        trash: state.removed.slice()
      };
      var response = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = {};
      try { data = await response.json(); } catch (error) { /* 忽略 */ }
      if (!response.ok || !data.ok) throw new Error(data.error || ('保存失败（HTTP ' + response.status + '）'));
      state.dirty = false;
      state.removed = [];
      setStatus('已保存 ' + timeNow(), '');
      toast('已保存 · 刷新网站即可看到');
    } catch (error) {
      setStatus('保存失败', 'error');
      showErrors([error.message]);
    } finally {
      state.saving = false;
    }
  }

  /* ---------- 原始数据 ---------- */
  function fillRaw() {
    if (!els.raw || !state.site) return;
    els.raw.value = JSON.stringify(state.site, null, 2);
    state.rawTouched = false;
  }

  function applyRaw() {
    try {
      var data = JSON.parse(els.raw.value);
      if (!data || typeof data !== 'object' || !data.profile || !data.meta) {
        throw new Error('缺少 profile 或 meta');
      }
      if (!window.confirm('应用后会替换编辑器里的内容（还没保存），继续吗？')) return;
      state.site = normalize(data);
      state.postIndex = 0;
      state.removed = [];
      state.site.writing.items.forEach(function (post) {
        if (typeof state.bodies[post.slug] !== 'string') state.bodies[post.slug] = '';
      });
      renderAll();
      markDirty();
      state.rawTouched = false;
      toast('JSON 已应用，记得点保存');
    } catch (error) {
      showErrors(['JSON 解析失败：' + error.message]);
    }
  }

  /* ---------- 备份 ---------- */
  function exportBackup() {
    var payload = {
      exportedAt: new Date().toISOString(),
      site: state.site,
      posts: state.site.writing.items.map(function (post) {
        return { slug: post.slug, body: state.bodies[post.slug] || '' };
      })
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = doc.createElement('a');
    link.href = url;
    link.download = 'personal-site-backup-' + today() + '.json';
    doc.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('备份已导出');
  }

  function importBackup(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        if (!data.site) throw new Error('文件里没有 site 数据');
        if (!window.confirm('导入会覆盖当前编辑器里的内容（未保存的修改会丢失），继续吗？')) return;
        state.site = normalize(data.site);
        state.bodies = Object.create(null);
        (data.posts || []).forEach(function (post) { state.bodies[post.slug] = post.body || ''; });
        state.postIndex = 0;
        state.removed = [];
        renderAll();
        markDirty();
        toast('已导入，记得点保存');
      } catch (error) {
        showErrors(['导入失败：' + error.message]);
      }
    };
    reader.readAsText(file);
  }

  /* ---------- 面板与事件 ---------- */
  function showTab(name) {
    if (!doc.querySelector('[data-panel="' + name + '"]')) name = 'profile';
    $$('.admin-nav button').forEach(function (button) {
      button.classList.toggle('is-active', button.getAttribute('data-tab') === name);
    });
    $$('.panel').forEach(function (panel) {
      panel.classList.toggle('is-active', panel.getAttribute('data-panel') === name);
    });
    if (name === 'raw' && !state.rawTouched) fillRaw();
    try { history.replaceState(null, '', '#' + name); } catch (error) { /* 忽略 */ }
  }

  function addItem(kind) {
    if (kind === 'socials') {
      state.site.profile.socials.push({ label: '新链接', url: 'https://', icon: 'link' });
      renderSocials();
    } else if (kind === 'facts') {
      state.site.about.facts.push({ k: '项目', v: '内容' });
      renderFacts();
    } else if (kind === 'projects') {
      state.site.projects.items.push({
        title: '新项目', en: '', year: String(new Date().getFullYear()),
        description: '', tags: [], url: ''
      });
      renderProjects();
    } else if (kind === 'resume') {
      state.site.resume.items.push({
        key: 'resume-' + Date.now().toString(36), badge: 'RESUME',
        title: '新简历', subtitle: '', summary: '', tags: [],
        docx: 'assets/files/', pdf: 'assets/files/'
      });
      renderResumeItems();
    } else if (kind === 'timeline') {
      state.site.timeline.items.push({ period: '2026 — 至今', title: '新经历', description: '', current: false });
      renderTimeline();
    }
    markDirty();
  }

  function bindUI() {
    $('#admin-main').addEventListener('input', onFieldInput);

    $('#admin-main').addEventListener('change', function (event) {
      var slugInput = event.target.closest('[data-post-field="slug"]');
      if (slugInput) {
        changeSlug(slugInput);
        return;
      }
      // 复选框 / 日期框也同步到数据
      if (event.target.matches('[data-field], [data-path], [data-post-field]')) onFieldInput(event);
    });

    $('#admin-main').addEventListener('click', function (event) {
      var add = event.target.closest('[data-add]');
      if (add) {
        addItem(add.getAttribute('data-add'));
        return;
      }

      var action = event.target.closest('[data-action]');
      if (action) {
        var name = action.getAttribute('data-action');
        if (name === 'delete-post') { deletePost(); return; }
        if (name === 'toggle-preview') { togglePreview(); return; }
        var card = action.closest('[data-item]');
        if (!card) return;
        var kind = card.getAttribute('data-item');
        var list = getList(kind);
        var index = Number(card.getAttribute('data-index'));
        if (name === 'remove') {
          if (!window.confirm('确定删除这一条吗？')) return;
          list.splice(index, 1);
          if (kind === 'socials') renderSocials();
          if (kind === 'facts') renderFacts();
          if (kind === 'projects') renderProjects();
          if (kind === 'resume') renderResumeItems();
          if (kind === 'timeline') renderTimeline();
          markDirty();
          return;
        }
        if (name === 'up' && index > 0) {
          var previous = list[index - 1];
          list[index - 1] = list[index];
          list[index] = previous;
        }
        if (name === 'down' && index < list.length - 1) {
          var later = list[index + 1];
          list[index + 1] = list[index];
          list[index] = later;
        }
        if (kind === 'socials') renderSocials();
        if (kind === 'facts') renderFacts();
        if (kind === 'projects') renderProjects();
        if (kind === 'resume') renderResumeItems();
        if (kind === 'timeline') renderTimeline();
        markDirty();
        return;
      }

      var postButton = event.target.closest('[data-post-index]');
      if (postButton) {
        selectPost(Number(postButton.getAttribute('data-post-index')));
      }
    });

    $('#add-post').addEventListener('click', addPost);

    $$('.admin-nav button').forEach(function (button) {
      button.addEventListener('click', function () { showTab(button.getAttribute('data-tab')); });
    });

    els.save.addEventListener('click', save);
    els.backup.addEventListener('click', exportBackup);

    var importButton = $('#btn-import');
    if (importButton && els.importFile) {
      importButton.addEventListener('click', function () { els.importFile.click(); });
      els.importFile.addEventListener('change', function () {
        importBackup(this.files && this.files[0]);
        this.value = '';
      });
    }

    $('#raw-apply').addEventListener('click', applyRaw);
    $('#raw-reload').addEventListener('click', fillRaw);
    if (els.raw) els.raw.addEventListener('input', function () { state.rawTouched = true; });

    var themeButton = $('#admin-theme');
    if (themeButton) {
      themeButton.addEventListener('click', function () {
        var next = doc.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        doc.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch (error) { /* 忽略 */ }
      });
    }

    doc.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
    });

    window.addEventListener('beforeunload', function (event) {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  function showBlocked(error) {
    if (els.blocked) els.blocked.hidden = false;
    if (els.blockedDetail) {
      els.blockedDetail.textContent = error ? '错误信息：' + (error.message || error) : '';
    }
    setStatus('未连接', 'error');
  }

  function boot() {
    bindUI();
    fetch('/api/content', { cache: 'no-store' })
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok || !data.ok) throw new Error(data.error || ('HTTP ' + response.status));
          return data;
        });
      })
      .then(function (data) {
        state.site = normalize(data.site);
        (data.posts || []).forEach(function (post) { state.bodies[post.slug] = post.body || ''; });
        state.loaded = true;
        renderAll();
        setStatus('已同步', '');
        showTab((location.hash || '').replace('#', '') || 'profile');
      })
      .catch(showBlocked);
  }

  if (MD) boot();
  else showBlocked(new Error('Markdown 渲染器没有加载'));
})();