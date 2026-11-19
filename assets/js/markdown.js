/* ==========================================================================
   极简 Markdown 渲染器（无依赖，约 150 行）
   支持：标题、段落、粗体、斜体、删除线、行内代码、链接、图片、
        有序 / 无序列表、引用、分割线、代码块
   ========================================================================= */
(function (global) {
  'use strict';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) { return ESC[char]; });
  }

  function safeUrl(value) {
    var url = String(value).trim().replace(/^<|>$/g, '');
    if (!url) return '';
    if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
    if (/^(#|\/|\.\/|\.\.\/)/.test(url)) return url;
    return '';
  }

  // 中文行之间不插空格，英文行之间保留一个空格
  var CJK = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/;
  function joinLines(lines) {
    return lines.reduce(function (acc, line) {
      if (!acc) return line;
      var prev = acc.charAt(acc.length - 1);
      var next = line.charAt(0);
      var join = CJK.test(prev) && CJK.test(next) ? '' : ' ';
      return acc + join + line;
    }, '');
  }

  function inline(text) {
    var codes = [];

    // 先把行内代码抠出来，避免其中的符号被当成 Markdown
    text = text.replace(/`([^`\n]+)`/g, function (_, code) {
      codes.push(code);
      return '\u0000' + (codes.length - 1) + '\u0000';
    });

    text = escapeHtml(text);

    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, url) {
      var src = safeUrl(url.replace(/&amp;/g, '&'));
      if (!src) return alt;
      return '<img src="' + escapeHtml(src) + '" alt="' + alt + '" loading="lazy">';
    });

    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
      var href = safeUrl(url.replace(/&amp;/g, '&'));
      if (!href) return label;
      var external = /^https?:/i.test(href);
      return '<a href="' + escapeHtml(href) + '"' +
        (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + label + '</a>';
    });

    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    text = text.replace(/ {2,}\n/g, '<br>\n');

    // 还原行内代码
    text = text.replace(/\u0000(\d+)\u0000/g, function (_, index) {
      return '<code>' + escapeHtml(codes[Number(index)] || '') + '</code>';
    });

    return text;
  }

  function codeBlock(code, lang) {
    var safeLang = String(lang || '').replace(/[^\w+#-]/g, '').slice(0, 20);
    return '<div class="codeblock">' +
      '<div class="codeblock-bar"><span>' + escapeHtml(safeLang || 'code') + '</span>' +
      '<button class="code-copy" type="button">复制</button></div>' +
      '<pre><code' + (safeLang ? ' class="language-' + safeLang + '"' : '') + '>' +
      escapeHtml(code) + '</code></pre></div>';
  }

  function renderBlocks(source) {
    var lines = String(source).replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n');
    var out = [];
    var para = [];
    var i = 0;

    function flush() {
      if (!para.length) return;
      out.push('<p>' + inline(joinLines(para)) + '</p>');
      para = [];
    }

    while (i < lines.length) {
      var line = lines[i];

      // 代码块
      if (/^\s*```/.test(line)) {
        flush();
        var lang = line.replace(/^\s*```/, '').trim();
        var buffer = [];
        i += 1;
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          buffer.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        out.push(codeBlock(buffer.join('\n'), lang));
        continue;
      }

      // 空行
      if (!line.trim()) {
        flush();
        i += 1;
        continue;
      }

      // 标题（文章标题已是 h1，正文标题从 h2 起）
      var heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (heading) {
        flush();
        var level = Math.max(2, Math.min(heading[1].length, 4));
        out.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
        i += 1;
        continue;
      }

      // 分割线
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flush();
        out.push('<hr>');
        i += 1;
        continue;
      }

      // 引用（递归解析内部内容）
      if (/^\s*>\s?/.test(line)) {
        flush();
        var quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        out.push('<blockquote>' + renderBlocks(quote.join('\n')) + '</blockquote>');
        continue;
      }

      // 无序列表
      if (/^\s*[-*+]\s+/.test(line)) {
        flush();
        var ul = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          ul.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
          i += 1;
        }
        out.push('<ul>' + ul.map(function (item) {
          return '<li>' + inline(item) + '</li>';
        }).join('') + '</ul>');
        continue;
      }

      // 有序列表
      if (/^\s*\d+[.)]\s+/.test(line)) {
        flush();
        var ol = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          ol.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
          i += 1;
        }
        out.push('<ol>' + ol.map(function (item) {
          return '<li>' + inline(item) + '</li>';
        }).join('') + '</ol>');
        continue;
      }

      // 普通段落
      para.push(line.trim());
      i += 1;
    }

    flush();
    return out.join('\n');
  }

  function readingTime(source) {
    var text = String(source || '');
    var cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
    var words = text.replace(/[\u3400-\u9fff]/g, ' ').split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(cjk / 380 + words / 220));
  }

  global.Markdown = {
    render: function (source) { return renderBlocks(source || ''); },
    readingTime: readingTime,
    escape: escapeHtml
  };
})(window);