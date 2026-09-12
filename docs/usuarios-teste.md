# 👥 Usuários e Credenciais de Teste

Para facilitar o desenvolvimento, homologação e demonstração das capacidades de multi-tenant e controle de acesso (RBAC), o banco de dados do **Zentor WMS** já é populado por padrão com contas de testes e pedidos fictícios através do comando de seed.

Para aplicar essas credenciais no seu banco local, execute:
```bash
pnpm --filter @wms/api prisma db seed
```
*(Para mais detalhes de comandos de banco, acesse o [[setup-desenvolvimento|Guia de Setup Local]]).*

---

## 👑 Administrador da Plataforma (Admin WMS / Dono do WMS)

Este usuário é o **dono do sistema WMS** (provedor SaaS / infraestrutura). Ele não possui vínculo direto com nenhum tenant específico e possui visão e gestão global de todos os clientes e colaboradores.

| E-mail | Senha | Papel | Acesso | Capacidades e Responsabilidades |
| :--- | :--- | :--- | :--- | :--- |
| `admin@wms.local` | `admin123` | Plataforma Admin | Apenas Painel Web | **Dono do WMS:** Gerencia todos os clientes/empresas (`/platform/tenants`) e **todos os usuários do WMS** (`/platform/usuarios`), podendo cadastrar, editar, desativar ou redefinir senhas de qualquer usuário no sistema. Bloqueado para operar pedidos/estoque e não acessa o Mobile. |

---

## 🏢 Tenant `default` (Empresa de Demonstração Principal)

Contém dados de movimentação completos, dezenas de pedidos integrados (prefixo `ERP-DEMO-*`, `QA-H-*` e `ERP-10042`) e alertas de gôndola.
*CNPJ da Empresa:* `03.007.331/0001-41`

| E-mail | Senha | Papel | Web Dashboard | App Mobile | Descrição / Permissões |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `adm@wms.local` | `admin123` | Admin da Conta (`ADMIN`) | Sim | Sim | **Dono da Conta (Contratante do WMS):** Responsável por conectar o Tiny ERP (`/integracoes/tiny`), gerenciar todos os colaboradores da sua empresa (`/admin/usuarios`), configurações (`/admin/configuracoes`), relatórios e operações do armazém. |
| `admin@default.local` | `admin123` | Admin da Conta (`ADMIN`) | Sim | Sim | Alias do admin da conta para compatibilidade com o padrão multi-tenant. |
| `operador@wms.local` | `operador123` | Expedidor (`EXPEDITER`) | Sim | Não | **Operador (Acesso a Telas Específicas):** Acesso estritamente operacional: Dashboard, Cadastros, Layout do Galpão, Pedidos, Ondas, Recebimentos, Estoque e Packing. Não acessa integrações, configurações nem gestão de usuários. |
| `operador2@wms.local` | `operador123` | Expedidor (`EXPEDITER`) | Sim | Não | Expedidor operacional secundário com acesso às mesmas telas operacionais. |
| `picker@wms.local` | `dev` | Separador (`PICKER`) | Não | Sim | Operação no coletor móvel: fila de picking e separação em gôndola. |
| `maria@wms.local` | `dev` | Separador (`PICKER`) | Não | Sim | Separadora móvel. |
| `carlos@wms.local` | `dev` | Separador (`PICKER`) | Não | Sim | Separador móvel. |

---

## 🏬 Tenants Isolados (Demonstração Multi-Empresa)

Estes tenants simulam empresas/lojas menores rodando na mesma instalação WMS. Seus dados e estoques são totalmente isolados entre si e do tenant `default`.

### Loja Demo A (`demo-loja-a`) — CNPJ: `35.635.824/0001-12`
*   *Pedidos simulados*: `LOJA-A-001` até `LOJA-A-007`.

| E-mail | Senha | Papel | Web Dashboard | App Mobile |
| :--- | :--- | :--- | :--- | :--- |
| `admin@loja-a.local` | `admin123` | Admin da Conta (`ADMIN`) | Sim | Sim |
| `picker@loja-a.local` | `dev` | Separador (`PICKER`) | Não | Sim |

### Loja Demo B (`demo-loja-b`) — CNPJ: `15.436.940/0001-03`
*   *Pedidos simulados*: `LOJA-B-001` até `LOJA-B-007`.

| E-mail | Senha | Papel | Web Dashboard | App Mobile |
| :--- | :--- | :--- | :--- | :--- |
| `admin@loja-b.local` | `admin123` | Admin da Conta (`ADMIN`) | Sim | Sim |
| `picker@loja-b.local` | `dev` | Separador (`PICKER`) | Não | Sim |

### Loja Demo C (`demo-loja-c`) — CNPJ: `11.222.333/0001-44`
*   *Pedidos simulados*: `LOJA-C-001` até `LOJA-C-007`.

| E-mail | Senha | Papel | Web Dashboard | App Mobile |
| :--- | :--- | :--- | :--- | :--- |
| `admin@loja-c.local` | `admin123` | Admin da Conta (`ADMIN`) | Sim | Sim |
| `picker@loja-c.local` | `dev` | Separador (`PICKER`) | Não | Sim |

---

## 🔍 Regras e Hierarquia de Acesso (Pontos 5 a 8)

### 5. Hierarquia do Operador
* O operador não é dono da conta nem tem permissão de administrar o sistema.
* Possui acesso apenas às telas operacionais do CD: **Dashboard**, **Cadastros**, **Layout do galpão**, **Pedidos**, **Ondas**, **Recebimentos**, **Estoque** e **Packing**.
* Não visualiza e não tem acesso às rotas de **Configurações**, **Tiny ERP**, **Relatórios** e **Usuários e permissões**.

### 6. Admin da Conta (Dono da Empresa Contratante)
* É o usuário que contratou o WMS para a sua empresa (ex.: `adm@wms.local` para a empresa principal ou `admin@loja-a.local`).
* É o único responsável por **conectar o Tiny ERP** (`/integracoes/tiny`) e **gerenciar todos os colaboradores da sua conta** (`/admin/usuarios`).
* Pode cadastrar expedidores, separadores, ativar/desativar funcionários e controlar permissões de acesso web e mobile.

### 7. Admin WMS (Dono do Sistema WMS)
* É o super-administrador do SaaS Help Route WMS (`admin@wms.local`).
* Gerencia **todas as empresas clientes (Tenants)** em `/platform/tenants`.
* Gerencia **todos os usuários de todas as empresas do WMS** em `/platform/usuarios`, com busca, filtros por empresa e papel, edição cadastral, redefinição de senhas e troca de empresa.
* Não opera armazém (não separa pedidos nem faz packing).

### 8. Vínculo CNPJ e Múltipla Empresa
* Cada **Tenant** representa uma empresa contratante e possui seu respectivo **CNPJ** vinculado no banco de dados.
* O **Admin da Conta** e todos os seus colaboradores estão vinculados à empresa e ao seu CNPJ (`user.tenant.cnpj`).
* O sistema suporta **múltipla empresa**:
  * No nível do WMS: múltiplos Tenants isolados cadastrados pelo Admin WMS.
  * No nível do Tiny ERP: uma empresa pode ter múltiplas conexões Tiny cadastradas (`tiny_connections`), cada uma representando uma filial ou conta ERP com seu respectivo CNPJ e razão social.

---

## 🔍 O Que e Como Validar

Para testar a segurança e integridade do sistema localmente, realize os seguintes testes de validação:

### 1. Isolamento Multi-Tenant
1.  Faça login no painel web com `admin@loja-a.local` e abra a tela de pedidos. Você deve visualizar apenas pedidos com prefixo `LOJA-A-*`.
2.  Abra outra aba (ou use guia anônima) e faça login com `admin@loja-b.local`. Os pedidos visíveis devem ser estritamente com prefixo `LOJA-B-*`.
3.  Qualquer tentativa de requisição HTTP manual da loja B tentando ler IDs da loja A retornará status `403 Forbidden` ou `404 Not Found`.

### 2. Acesso Restrito do Super-Admin
1.  Logue com `admin@wms.local` no painel web.
2.  O menu lateral exibirá **apenas** a opção **Clientes** (ou Clientes/Tenants). Os menus Dashboard, Estoque, Recebimento e Configurações de Onda não serão exibidos.
3.  Tente fazer login com `admin@wms.local` na tela inicial do aplicativo mobile. O sistema deve recusar o login informando falta de permissões de mobilidade (`mobile.access`).

### 3. Acesso Mobile por Papel
1.  Tente logar no aplicativo mobile com `operador@wms.local`. Como o seu papel padrão é `EXPEDITER` e por padrão não possui acesso móvel ativo no seed, o login deve ser negado.
2.  Logue com `picker@wms.local`. O acesso será liberado exibindo as filas de separação de gôndola ativas.

### 4. Gestão de Usuários e Configurações pelo Admin da Conta
1.  Logue com `adm@wms.local` (senha `admin123`) no painel web.
2.  O menu lateral exibirá a seção **Admin** com **Relatórios**, **Usuários e permissões** (`/admin/usuarios`) e **Configurações** (`/admin/configuracoes`).
3.  Em `/admin/usuarios`, o administrador pode criar novos colaboradores, ativar/desativar funcionários e conceder ou revogar permissões granulares (como acesso web e móvel).
4.  Em `/admin/configuracoes`, o administrador pode ajustar parâmetros globais (nome da empresa, parâmetros de onda, etc.).

Para entender a lista completa de ações que cada papel pode exercer, acesse o guia de [[arquitetura-e-seguranca|Arquitetura e Segurança]].
