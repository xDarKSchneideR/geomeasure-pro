/**
 * validate-env.mjs
 * Valida variables de entorno críticas antes del deploy
 * Uso: node scripts/validate-env.mjs --mode=frontend|backend|all
 * 
 * ? Carga automática de .env.local (sin necesidad de instalar dotenv)
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// ?? Cargar .env.local automáticamente (sin instalar dotenv)
// Esto permite que el script funcione en local sin variables globales
const envPath = join(rootDir, '.env.local');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    line = line.trim();
    // Ignorar líneas vacías y comentarios
    if (line && !line.startsWith('#')) {
      const eqIndex = line.indexOf('=');
      if (eqIndex !== -1) {
        const key = line.substring(0, eqIndex).trim();
        // Remover comillas simples o dobles del valor si existen
        let value = line.substring(eqIndex + 1).trim();
        value = value.replace(/^['"]|['"]$/g, '');
        // Solo asignar si no existe ya en process.env (prioridad a variables del sistema)
        if (key && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  });
}

// ?? Variables CRÍTICAS por entorno
const CRITICAL_VARS = {
  frontend: [
    // ?? Estas NO deben contener secretos reales - solo configuración pública
    { 
      name: 'VITE_API_BASE_URL', 
      pattern: /^https:\/\//, 
      error: 'Debe ser una URL HTTPS válida (ej: https://tu-api.onrender.com)' 
    },
    { name: 'VITE_MAP_TILE_URL', optional: true }
  ],
  backend: [
    { 
      name: 'JWT_SECRET', 
      minLen: 32, 
      error: 'Debe tener al menos 32 caracteres. Genera una con: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"' 
    },
    { 
      name: 'DATABASE_URL', 
      pattern: /^postgresql:\/\//, 
      error: 'Debe ser una conexión PostgreSQL válida (Neon/Render)' 
    },
    { 
      name: 'GEMINI_API_KEY', 
      minLen: 20, 
      error: 'Clave de Gemini inválida - NUNCA exponer al frontend' 
    },
    { 
      name: 'NODE_ENV', 
      allowed: ['production', 'staging', 'development'], 
      error: 'Debe ser "production", "staging" o "development"' 
    },
    { name: 'PORT', optional: true }
  ]
};

// ?? Colores para terminal (compatible con Windows/Linux/macOS)
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

const log = {
  error: (msg) => console.error(`${colors.red}? ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}? ${msg}${colors.reset}`),
  warn: (msg) => console.warn(`${colors.yellow}??  ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}??  ${msg}${colors.reset}`),
  header: (msg) => console.log(`\n${colors.bold}${colors.cyan}?? ${msg}${colors.reset}\n`)
};

// ?? Función de validación de una variable
function validateVar({ name, pattern, minLen, maxLen, allowed, optional, error }, value, envName) {
  // Caso 1: Variable no definida
  if (!value) {
    if (optional) {
      return { valid: true, warning: `Variable opcional '${name}' no definida` };
    }
    return { valid: false, error: `? ${envName}: '${name}' NO está definida. ${error || 'Requerida'}` };
  }

  // Caso 2: Validar patrón regex
  if (pattern && !pattern.test(value)) {
    return { valid: false, error: `? ${envName}: '${name}' tiene formato inválido. ${error}` };
  }

  // Caso 3: Longitud mínima
  if (minLen && value.length < minLen) {
    return { valid: false, error: `? ${envName}: '${name}' es muy corta (mín. ${minLen} chars, actual: ${value.length})` };
  }

  // Caso 4: Longitud máxima
  if (maxLen && value.length > maxLen) {
    return { valid: false, error: `? ${envName}: '${name}' es muy larga (máx. ${maxLen} chars, actual: ${value.length})` };
  }

  // Caso 5: Valores permitidos específicos
  if (allowed && !allowed.includes(value)) {
    return { valid: false, error: `? ${envName}: '${name}' debe ser una de: ${allowed.join(', ')}` };
  }

  // ?? Warning para valores por defecto peligrosos (anti-patterns de seguridad)
  const dangerousDefaults = [
    'secret', 'change-me', 'change_me', 'changeme', 
    'test', 'dev', 'localhost', 'example', 
    'geomeasure-secret', 'my-secret', 'jwt-secret',
    'your_', 'your-', 'replace', 'todo'
  ];
  
  const lowerValue = value.toLowerCase();
  if (dangerousDefaults.some(def => lowerValue.includes(def))) {
    return { 
      valid: false, 
      error: `? ${envName}: '${name}' usa un valor por defecto INSEGURO ("${value}"). ¡Genera uno único!` 
    };
  }

  // ? Todo correcto
  return { valid: true };
}

// ?? Escanear código frontend en busca de secretos expuestos (heurística básica)
function scanForExposedSecrets(rootDir) {
  const riskyPatterns = [
    { pattern: /AIza[0-9A-Za-z\-_]{35}/, name: 'Google API Key' },
    { pattern: /sk-[a-zA-Z0-9]{40,}/, name: 'OpenAI/Gemini Key' },
    { pattern: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub Token' },
    { pattern: /JWT_SECRET\s*=\s*['"][^'"]+['"]/i, name: 'JWT Secret hardcodeado' },
    // ? Solo alerta si hay claves de BD o APIs sensibles escritas literalmente
    { pattern: /(DATABASE_URL|MONGODB_URI|SUPABASE_KEY|FIREBASE_SECRET)\s*[=:]\s*['"][^'"]+['"]/i, name: 'Credencial de DB/Backend expuesta' }
  ];

  const results = [];
  
  // Escanear archivos específicos que suelen contener configuración
  const filesToScan = [
    join(rootDir, 'vite.config.ts'),
    join(rootDir, 'vite.config.js'),
    join(rootDir, 'src', 'config', 'env.ts'),
    join(rootDir, 'src', 'main.tsx'),
    join(rootDir, 'src', 'main.jsx')
  ];

  for (const filePath of filesToScan) {
    if (!existsSync(filePath)) continue;
    
    try {
      const content = readFileSync(filePath, 'utf8');
      const relativePath = filePath.replace(rootDir + '/', '');
      
      for (const { pattern, name } of riskyPatterns) {
        if (pattern.test(content)) {
          results.push({ file: relativePath, secret: name });
        }
      }
    } catch (e) {
      // Ignorar errores de lectura
    }
  }
  
  return results;
}

// ?? Función principal de ejecución
async function main() {
  // Parsear argumentos de línea de comandos
  const args = Object.fromEntries(
    process.argv.slice(2)
      .map(arg => arg.split('='))
      .map(([k, v]) => [k.replace('--', ''), v || true])
  );
  
  const mode = args.mode || 'all';
  const isCI = process.env.CI === 'true' || 
               process.env.NETLIFY === 'true' || 
               process.env.RENDER === 'true' ||
               process.env.GITHUB_ACTIONS === 'true';
  
  log.header(`Validación de Seguridad Pre-Deploy [${mode.toUpperCase()}]`);
  if (isCI) log.info('?? Ejecutando en entorno CI/CD');

  let hasErrors = false;
  const results = [];

  // Determinar qué entornos validar
  const modesToValidate = mode === 'all' ? ['frontend', 'backend'] : [mode];

  for (const envType of modesToValidate) {
    const vars = CRITICAL_VARS[envType];
    if (!vars) {
      log.warn(`Modo '${envType}' no reconocido. Modos válidos: frontend, backend, all`);
      continue;
    }

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

  // ?? Check adicional: detectar secretos expuestos en código frontend
  if (mode === 'all' || mode === 'frontend') {
    log.info('Escaneando frontend en busca de secretos expuestos...');
    const exposed = scanForExposedSecrets(rootDir);
    
    if (exposed.length > 0) {
      log.error(`?? Se detectaron ${exposed.length} posible(s) secreto(s) expuesto(s):`);
      exposed.forEach(({ file, secret }) => {
        log.error(`   • ${secret} en ${file}`);
      });
      hasErrors = true;
    } else {
      log.success('? No se detectaron secretos expuestos en código frontend');
    }
  }

  // ?? Resumen final
  console.log('\n' + '-'.repeat(70));
  log.header('Resumen de Validación');
  
  const stats = {
    ok: results.filter(r => r.status === 'OK').length,
    warn: results.filter(r => r.status === 'WARN').length,
    fail: results.filter(r => r.status === 'FAIL').length
  };

  console.log(`${colors.green}? Exitosas:${colors.reset} ${stats.ok}`);
  console.log(`${colors.yellow}??  Advertencias:${colors.reset} ${stats.warn}`);
  console.log(`${colors.red}? Errores:${colors.reset} ${stats.fail}`);
  console.log('-'.repeat(70) + '\n');

  // ?? Mensajes de ayuda contextual
  if (hasErrors) {
    log.error('?? VALIDACIÓN FALLIDA: No se puede proceder con el deploy.');
    log.info('?? Soluciones:');
    if (modesToValidate.includes('frontend')) {
      log.info('   • Frontend (Netlify): Site settings ? Build & deploy ? Environment variables');
      log.info('   • Local: Crea .env.local con VITE_API_BASE_URL=https://tu-backend.com');
    }
    if (modesToValidate.includes('backend')) {
      log.info('   • Backend (Render): Dashboard ? Environment ? Add Variable');
      log.info('   • Genera JWT_SECRET segura: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    }
    process.exit(1);
  } else {
    if (stats.warn > 0) {
      log.warn('??  Validación completada con advertencias. Revisa las variables opcionales.');
    } else {
      log.success('? Todas las validaciones pasaron. ¡Listo para deploy! ??');
    }
    process.exit(0);
  }
}

// ??? Manejo de errores no capturados
process.on('uncaughtException', (err) => {
  log.error(`Error inesperado: ${err.message}`);
  log.info('?? Ejecuta con DEBUG=* para más detalles');
  process.exit(2);
});

process.on('unhandledRejection', (reason) => {
  log.error(`Promesa rechazada: ${reason}`);
  process.exit(2);
});

// Ejecutar
main().catch(err => {
  log.error(`Fallo en ejecución: ${err.message}`);
  if (err.stack) {
    log.info('Stack trace:');
    console.error(err.stack);
  }
  process.exit(2);
});