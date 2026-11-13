import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import assert from 'node:assert/strict';
assert(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Emulators required');
const projectId = 'demo-cbt-school';
const app = initializeApp({ projectId }, 'browser-fixture'); const auth = getAuth(app); const db = getFirestore(app);
const password = 'Test-Only-Password-234';
const owner = await auth.createUser({ email: 'owner@example.test', password });
await db.doc(`users/${owner.uid}`).set({ role: 'superadmin', displayName: 'School Owner', email: 'owner@example.test' });
await db.doc('school/settings').set({ name: 'Pilot Secondary School', address: 'Osogbo', contact: '', academicSession: '2026/2027', term: 'First', classes: ['JSS1 A'], subjects: ['Mathematics'] });
const api = spawn(process.execPath, ['../server/dev.mjs'], { env: { ...process.env, GCLOUD_PROJECT: projectId }, stdio: 'inherit' });
const web = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173'], { env: { ...process.env, VITE_USE_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: projectId, VITE_FIREBASE_API_KEY: 'demo-key' }, stdio: 'inherit' });
let browser;
async function ready(url) { const deadline = Date.now() + 20000; while (Date.now() < deadline) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise(r => setTimeout(r, 200)); } throw new Error('Dev server failed to start'); }
try {
  await ready('http://127.0.0.1:5173');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext(); const page = await context.newPage(); const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error('BROWSER ERROR:', e.stack); }); page.on('console', message => { if (message.type() === 'error') console.error('BROWSER CONSOLE:', message.text()); });
  async function login(identifier) { await page.goto('http://127.0.0.1:5173/login'); console.log('LOGIN PAGE:', await page.title(), await page.locator('body').innerText()); await page.getByLabel('Username or email').fill(identifier); await page.getByPlaceholder('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); }
  await login('owner@example.test'); await page.waitForURL('**/dashboard');
  await page.getByRole('link', { name: 'School setup', exact: true }).click(); await page.getByLabel(/^name$/i).fill('Pilot Secondary School'); await page.getByRole('button', { name: 'Save school settings' }).click(); await page.getByText('School settings saved.', { exact: false }).waitFor();
  await page.getByRole('link', { name: 'Students', exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Alice Student'); await page.getByLabel('Permanent username').fill('alice-school'); await page.getByLabel('Temporary password').fill(password); await page.getByLabel(/^Class/).selectOption('JSS1 A'); await page.getByLabel('Mathematics', { exact: true }).check();
  await page.getByRole('button', { name: 'Create student', exact: true }).click(); await page.getByText('Student created.', { exact: false }).waitFor();
  await page.getByRole('link', { name: 'Exams', exact: true }).click(); await page.getByLabel('Exam title').fill('Mathematics Pilot'); await page.getByLabel('Duration in minutes').fill('15'); await page.getByLabel(/^Class/).selectOption('JSS1 A'); await page.getByLabel(/^Subject/).selectOption('Mathematics'); await page.getByRole('button', { name: 'Create exam', exact: true }).click(); await page.getByText('Exam created.', { exact: false }).waitFor();
  await page.getByRole('link', { name: 'Add Questions', exact: true }).click(); await page.getByRole('heading', { name: 'Manual entry', exact: true }).waitFor(); await page.locator('select').first().selectOption({ label: 'Mathematics Pilot' }); await page.getByPlaceholder('Type the question prompt').fill('What is 2 + 2?');
  for (const [key, value] of Object.entries({ A: '3', B: '4', C: '5', D: '6' })) await page.getByPlaceholder(`Option ${key}`, { exact: true }).fill(value);
  await page.locator('select').nth(1).selectOption('B'); await page.getByRole('button', { name: 'Save question', exact: true }).click(); await page.getByText('Question saved successfully.').waitFor();
  await page.getByRole('link', { name: 'Exams', exact: true }).click(); await page.getByRole('button', { name: 'Publish', exact: true }).click(); await page.getByText('Exam published.', { exact: false }).waitFor();
  await page.getByRole('link', { name: 'Exam PINs', exact: true }).click(); await page.waitForURL('**/exam-pins'); await page.getByRole('combobox', { name: /^Exam/ }).selectOption({ label: 'Mathematics Pilot (published)' }); await page.getByLabel('Alice Student', { exact: false }).check(); await page.getByRole('button', { name: 'Assign exam and generate PINs' }).click();
  const pinCell = page.locator('td.font-mono'); await pinCell.waitFor(); const pin = (await pinCell.textContent()).trim();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await login('alice-school'); await page.waitForURL('**/portal'); await page.getByPlaceholder('Enter your personal PIN').fill(pin); await page.getByRole('button', { name: 'Start exam', exact: true }).click(); await page.waitForURL('**/exam/**');
  await page.locator('input[type=radio][value=B]').waitFor();
  if (await page.getByRole('button', { name: 'Open exam', exact: true }).isVisible()) await page.getByRole('button', { name: 'Open exam', exact: true }).click();
  const duplicate = await page.context().newPage();
  await duplicate.goto(page.url());
  await duplicate.getByText('This exam is already open in another tab.', { exact: false }).waitFor();
  await duplicate.close();
  await page.bringToFront();
  if (await page.getByRole('button', { name: 'Open exam', exact: true }).isVisible()) await page.getByRole('button', { name: 'Open exam', exact: true }).click();
  await page.locator('input[type=radio][value=B]').check();
  await page.reload();
  await page.locator('input[type=radio][value=B]').waitFor();
  if (await page.getByRole('button', { name: 'Open exam', exact: true }).isVisible()) await page.getByRole('button', { name: 'Open exam', exact: true }).click();
  await page.locator('input[type=radio][value=B]').waitFor(); assert(await page.locator('input[type=radio][value=B]').isChecked(), 'Refresh preserves answer');
  page.on('dialog', d => d.accept()); await page.getByRole('button', { name: 'Submit exam', exact: true }).click(); await page.waitForURL('**/portal');
  const deadline = Date.now() + 15000; let result;
  while (Date.now() < deadline) { const rows = await db.collection('examResults').get(); if (!rows.empty) { result = rows.docs[0].data(); break; } await new Promise(r => setTimeout(r, 200)); }
  assert.equal(result?.finalScore, 1); assert.equal(result?.released, false); assert.equal(errors.length, 0, errors.join('\n'));
  await page.screenshot({ path: '/tmp/cbt-school-student.png', fullPage: true });
  console.log('PASS: browser admin setup → student provision → exam author/publish → PIN → student start → answer → refresh → submit → server score');
} catch (error) {
  for (const context of browser?.contexts() || []) for (const page of context.pages()) console.error('FAILED PAGE:', page.url(), await page.locator('body').innerText().catch(() => 'Unavailable'));
  throw error;
} finally { await browser?.close(); api.kill(); web.kill(); await deleteApp(app); }
