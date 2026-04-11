#!/usr/bin/env node
/**
 * validate-env.mjs
 * Valida variables de entorno críticas antes del deploy
 * Uso: node scripts/validate-env.mjs --mode=frontend|backend|all
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// 🎯 Variables CRÍTICAS por entorno
const CRITICAL_VARS = {
  frontend: [
    // ⚠️ Estas NO deben contener secretos reales
    { name: 'VITE_API_BASE_URL', pattern: /^https:\/\//, error: 'Debe ser una URL HTTPS válida' },
    { name: 'VITE_MAP_TILE_URL', optional: true }
  ],
  backend: [
    { name: 'JWT_SECRET', minLen: 32, error: 'Debe tener al menos 32 caracteres (usa crypto.randomBytes(64))' },
    { name: 'DATABASE_URL', pattern: /^postgresql:\/\//, error: 'Debe ser una conexión PostgreSQL válida (Neon)' },
    { name: 'NODE_ENV', allowed: ['production', 'staging'], error: 'Debe ser "production" o "staging"' },
    { name: 'PORT', optional: true }
  ]
};

// 🎨 Colores para terminal
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

const log = {
  error: (msg) => console.error(`${colors.red}❌ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  warn: (msg) => console.warn(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
  header: (msg) => console.log(`\n${colors.bold}${colors.blue}🔐 ${msg}${colors.reset}\n`)
};

// 🔍 Función de validación principal
function validateVar({ name, pattern, minLen, maxLen, allowed, optional, error }, value, envName) {
  if (!value) {
    if (optional) return { valid: true, warning: `Variable opcional '${name}' no definida` };
    return { valid: false, error: `❌ ${envName}: '${name}' NO está definida. ${error || 'Requerida'}` };
  }

  if (pattern && !pattern.test(value)) {
    return { valid: false, error: `❌ ${envName}: '${name}' tiene formato inválido. ${error}` };
  }

  if (minLen && value.length < minLen) {
    return { valid: false, error: `❌ ${envName}: '${name}' es muy corta (mín. ${minLen} chars)` };
  }

  if (maxLen && value.length > maxLen) {
    return { valid: false, error: `❌ ${envName}: '${name}' es muy larga (máx. ${maxLen} chars)` };
  }

  if (allowed && !allowed.includes(value)) {
    return { valid: false, error: `❌ ${envName}: '${name}' debe ser una de: ${allowed.join(', ')}` };
  }

  // ⚠️ Warning para valores por defecto peligrosos
  const dangerousDefaults = ['secret', 'change-me', 'test', 'dev', 'localhost', 'geomeasure-secret'];
  if (dangerousDefaults.some(def => value.toLowerCase().includes(def))) {
    return { valid: false, error: `❌ ${envName}: '${name}' usa un valor por defecto INSEGURO. ¡Cámbialo!` };
  }

  return { valid: true };
}

// 🚀 Ejecutar validación
async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map(arg => arg.split('=')).map(([k, v]) => [k.replace('--', ''), v])
  );
  
  const mode = args.mode || 'all';
  const isCI = process.env.CI === 'true' || process.env.NETLIFY === 'true' || process.env.RENDER === 'true';
  
  log.header(`Validación de Seguridad Pre-Deploy [${mode.toUpperCase()}]`);
  if (isCI) log.info('🤖 Ejecutando en entorno CI/CD');

  let hasErrors = false;
  const results = [];

  // Validar según modo
  const modesToValidate = mode === 'all' ? ['frontend', 'backend'] : [mode];

  for (const envType of modesToValidate) {
    const vars = CRITICAL_VARS[envType];
    if (!vars) continue;

    log.info(`Validando variables para ${envType.toUpperCase()}...`);
    
    for (const rule of vars) {
      const value = process.env[rule.name];
      const result = validateVar(rule, value, envType);
      
      if (!result.valid) {
        log.error(result.error);
        results.push({ var: rule.name, env: envType, status: 'FAIL', message: result.error });
        hasErrors = true;
      } else if (result.warning) {
        log.warn(result.warning);
        results.push({ var: rule.name, env: envType, status: 'WARN', message: result.warning });
      } else {
        results.push({ var: rule.name, env: envType, status: 'OK' });
      }
    }
  }

  // 🔎 Check adicional: detectar secretos expuestos en código
  if (mode === 'all' || mode === 'frontend') {
    log.info('Escaneando frontend en busca de secretos expuestos...');
    const riskyPatterns = [
      { pattern: /AIza[0-9A-Za-z\-_]{35}/, name: 'Google API Key' },
      { pattern: /sk-[a-zA-Z0-9]{48}/, name: 'OpenAI/Gemini Key' },
      { pattern: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub Token' },
      { pattern: /JWT_SECRET\s*=\s*['"][^'"]+['"]/i, name: 'Hardcoded JWT Secret' }
    ];

    try {
      const viteConfig = readFileSync(join(rootDir, 'vite.config.ts'), 'utf8');
      for (const { pattern, name } of riskyPatterns) {
        if (pattern.test(viteConfig)) {
          log.error(`🔴 Secreto detectado en vite.config.ts: ${name}`);
          hasErrors = true;
        }
      }
    } catch (e) {
      log.warn('No se pudo leer vite.config.ts para escaneo');
    }
  }

  // 📊 Resumen final
  console.log('\n' + '─'.repeat(60));
  log.header('Resumen de Validación');
  
  const stats = {
    ok: results.filter(r => r.status === 'OK').length,
    warn: results.filter(r => r.status === 'WARN').length,
    fail: results.filter(r => r.status === 'FAIL').length
  };

  console.log(`✅ Exitosas: ${stats.ok}`);
  console.log(`⚠️  Advertencias: ${stats.warn}`);
  console.log(`❌ Errores: ${stats.fail}`);
  console.log('─'.repeat(60) + '\n');

  if (hasErrors) {
    log.error('🚫 VALIDACIÓN FALLIDA: No se puede proceder con el deploy.');
    log.info('💡 Solución: Configura las variables faltantes en:');
    log.info('   • Frontend (Netlify): Site settings > Environment variables');
    log.info('   • Backend (Render): Dashboard > Environment');
    process.exit(1);
  } else {
    log.success('✅ Todas las validaciones pasaron. ¡Listo para deploy! 🚀');
    process.exit(0);
  }
}

// Manejar errores no capturados
process.on('uncaughtException', (err) => {
  log.error(`Error inesperado: ${err.message}`);
  process.exit(2);
});

main().catch(err => {
  log.error(`Fallo en validación: ${err.message}`);
  process.exit(2);
});