<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="header-inner">
        <span class="logo-mark">&lt;/&gt;</span>
        <div>
          <h1 class="app-title">Analizador Léxico · Sintáctico</h1>
          <p class="app-subtitle">Python — basado en Flex</p>
        </div>
      </div>
    </header>
    <main class="app-main">
      <LexerUpload />
    </main>
  </div>
</template>

<script setup>
import LexerUpload from './components/LexerUpload.vue'
</script>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Segoe UI', system-ui, sans-serif;
  background: #0d1117;
  color: #e6edf3;
  min-height: 100vh;
}

.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-header {
  background: #161b22;
  border-bottom: 1px solid #30363d;
  padding: 16px 32px;
}

.header-inner {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 14px;
}

.logo-mark {
  font-family: 'Courier New', monospace;
  font-size: 26px;
  font-weight: 700;
  color: #58a6ff;
  background: #1c2128;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid #30363d;
  line-height: 1;
}

.app-title {
  font-size: 18px;
  font-weight: 600;
  color: #e6edf3;
  letter-spacing: -0.01em;
}

.app-subtitle {
  font-size: 12px;
  color: #8b949e;
  margin-top: 2px;
  font-family: 'Courier New', monospace;
}

.app-main {
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
  padding: 28px 24px;
}
</style>