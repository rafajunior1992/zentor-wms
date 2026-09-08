# Mobile APK Homolog — Implementation Plan

> **For agentic workers:** COMPLETE ALL TASKS. Steps use checkbox (`- [ ]`) syntax.

**Goal:** APK Android instalável apontando para API de homologação.

**Spec:** `docs/superpowers/specs/2026-09-03-mobile-apk-homolog-design.md`

**Tech:** EAS Build profile `preview` em `apps/mobile/eas.json`

---

### Task 1: Verificar conta Expo / EAS

- [ ] `cd apps/mobile && npx eas-cli whoami`
- [ ] Se não logado, pedir login ao usuário (`eas login`)

### Task 2: Disparar build APK preview

- [ ] `npx eas-cli build -p android --profile preview --non-interactive`
- [ ] Confirmar env `EXPO_PUBLIC_API_URL` = homolog sslip.io

### Task 3: Entregar link aos testadores

- [ ] Passar URL do build / download do APK
- [ ] Credenciais: `picker@wms.local` / `dev` (e demais em `docs/usuarios-teste.md`)
