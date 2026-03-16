/**
 * CORS 代理服务器 - Node.js 版本（支持流式传输）
 * 用法：node proxy.js
 */

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders({}));
    res.end();
    return;
  }

  const rawPath = req.url.slice(1);

  if (!rawPath || (!rawPath.startsWith('http://') && !rawPath.startsWith('https://'))) {
    res.writeHead(400, corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
    res.end(JSON.stringify({ error: '请求格式错误', usage: `http://localhost:${PORT}/https://目标API地址/路径` }, null, 2));
    return;
  }

  const targetUrl = url.parse(rawPath);
  const isHttps = rawPath.startsWith('https://');
  const transport = isHttps ? https : http;
  const time = new Date().toLocaleTimeString('zh-CN');

  // 收集请求 body
  let chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    // 判断是否为流式请求
    let isStream = false;
    try {
      const parsed = JSON.parse(body.toString());
      isStream = parsed.stream === true;
      console.log(`\n[${time}] ${req.method} ${targetUrl.hostname}${targetUrl.path} ${isStream ? '🔄 流式' : '📦 普通'}`);
    } catch(e) {
      console.log(`\n[${time}] ${req.method} ${targetUrl.hostname}${targetUrl.path}`);
    }

    const forwardHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() !== 'host') forwardHeaders[k] = v;
    }
    if (body.length > 0) forwardHeaders['content-length'] = body.length;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.path,
      method: req.method,
      headers: forwardHeaders,
    };

    const proxyReq = transport.request(options, (proxyRes) => {
      console.log(`  ← HTTP ${proxyRes.statusCode}${isStream ? ' (流式转发中...)' : ''}`);

      // 清理原始响应里的 CORS 头，避免重复
      const cleanHeaders = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (!k.toLowerCase().startsWith('access-control-')) {
          cleanHeaders[k] = v;
        }
      }

      if (isStream && proxyRes.statusCode === 200) {
        // 流式模式：去掉 content-length，加 Transfer-Encoding 让数据边收边发
        delete cleanHeaders['content-length'];
        cleanHeaders['transfer-encoding'] = 'chunked';
        cleanHeaders['cache-control'] = 'no-cache';
        cleanHeaders['x-accel-buffering'] = 'no';  // 禁用 Nginx 缓冲（如有）

        const responseHeaders = corsHeaders(cleanHeaders);
        res.writeHead(proxyRes.statusCode, responseHeaders);

        // 直接 pipe，每收到一块数据就立刻转发给浏览器
        let byteCount = 0;
        proxyRes.on('data', chunk => {
          byteCount += chunk.length;
          res.write(chunk);
        });
        proxyRes.on('end', () => {
          console.log(`  ✅ 流式完成，共 ${byteCount} bytes`);
          res.end();
        });
        proxyRes.on('error', err => {
          console.error('  ❌ 流式错误:', err.message);
          res.end();
        });

      } else {
        // 非流式或错误响应：缓冲后整体返回（方便打印错误日志）
        let respChunks = [];
        proxyRes.on('data', c => respChunks.push(c));
        proxyRes.on('end', () => {
          const respBody = Buffer.concat(respChunks);

          if (proxyRes.statusCode >= 400) {
            try {
              console.log('  ❌ 错误:', JSON.stringify(JSON.parse(respBody.toString()), null, 2));
            } catch(e) {
              console.log('  ❌ 错误响应:', respBody.toString().slice(0, 500));
            }
          } else {
            console.log(`  ✅ 成功，${respBody.length} bytes`);
          }

          cleanHeaders['content-length'] = respBody.length;
          res.writeHead(proxyRes.statusCode, corsHeaders(cleanHeaders));
          res.end(respBody);
        });
      }
    });

    proxyReq.on('error', (err) => {
      console.error('  ❌ 连接失败:', err.message);
      if (!res.headersSent) {
        res.writeHead(502, corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
        res.end(JSON.stringify({ error: '代理连接失败', detail: err.message }, null, 2));
      }
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  });
});

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    ...extra
  };
}

server.listen(PORT, () => {
  console.log('');
  console.log('✅ CORS 代理已启动（支持流式传输）');
  console.log('🌐 地址：http://localhost:' + PORT);
  console.log('');
  console.log('常用 Base URL：');
  console.log('  通义千问  →  https://coding.dashscope.aliyuncs.com/v1');
  console.log('  OpenAI    →  https://api.openai.com');
  console.log('  DeepSeek  →  https://api.deepseek.com');
  console.log('  智谱 GLM  →  https://open.bigmodel.cn/api/paas');
  console.log('');
  console.log('按 Ctrl+C 停止');
  console.log('');
});