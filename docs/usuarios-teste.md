# 👥 Usuários e Credenciais de Teste

Para facilitar o desenvolvimento, homologação e demonstração das capacidades de multi-tenant e controle de acesso (RBAC), o banco de dados do **Zentor WMS** já é populado por padrão com contas de testes e pedidos fictícios através do comando de seed.

Para aplicar essas credenciais no seu banco local, execute:
```bash
pnpm --filter @wms/api prisma db seed
```
*(Para mais detalhes de comandos de banco, acesse o [[setup-desenvolvimento|Guia de Setup Local]]).*

---

## 👑 Administrador da Plataforma (Super-Admin)

Este usuário gerencia o WMS a nível de infraestrutura/provedor. Ele não possui vínculo com nenhum tenant de cliente.

| E-mail | Senha | Papel | Acesso | Restrições |
| :--- | :--- | :--- | :--- | :--- |
| `admin@wms.local` | `admin123` | Plataforma Admin | Apenas Painel Web | Bloqueado para operar pedidos/estoque e não acessa o Mobile. |

---

## 🏢 Tenant `default` (Empresa de Demonstração Principal)

Contém dados de movimentação completos, dezenas de pedidos integrados (prefixo `ERP-DEMO-*`, `QA-H-*` e `ERP-10042`) e alertas de gôndola.

| E-mail | Senha | Papel | Web Dashboard | App Mobile | Descrição / Permissões |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `adm@wms.local` | `admin123` | Admin da Conta (`ADMIN`) | Sim | Sim | **Acesso total à conta:** Dashboard, Pedidos, Estoque, Usuários e Permissões (`/admin/usuarios`), Configurações (`/admin/configuracoes`) e Relatórios. |
| `admin@default.local` | `admin123` | Admin da Conta (`ADMIN`) | Sim | Sim | Alias do admin da conta para compatibilidade com o padrão multi-tenant. |
| `operador@wms.local` | `operador123` | Expedidor (`EXPEDITER`) | Sim | Não | Operação do CD: Pedidos, Packing, Estoque e Recebimento (sem gerenciar usuários ou configurações globais). |
| `operador2@wms.local` | `operador123` | Expedidor (`EXPEDITER`) | Sim | Não | Expedidor operacional secundário. |
| `picker@wms.local` | `dev` | Separador (`PICKER`) | Não | Sim | Operação no coletor móvel: fila de picking e separação em gôndola. |
| `maria@wms.local` | `dev` | Separador (`PICKER`) | Não | Sim | Separadora móvel. |
| `carlos@wms.local` | `dev` | Separador (`PICKER`) | Não | Sim | Separador móvel. |

---

## 🏬 Tenants Isolados (Demonstração Multi-Loja)

Estes tenants simulam lojas menores rodando na mesma instalação WMS. Seus dados são totalmente isolados entre si e do tenant `default`.

### Loja Demo A (`demo-loja-a`)
*   *Pedidos simulados*: `LOJA-A-001` até `LOJA-A-007`.

| E-mail | Senha | Papel | Web Dashboard | App Mobile |
| :--- | :--- | :--- | :--- | :--- |
| `admin@loja-a.local` | `admin123` | Tenant Admin (`ADMIN`) | Sim | Sim |
| `picker@loja-a.local` | `dev` | Separador (`PICKER`) | Não | Sim |

### Loja Demo B (`demo-loja-b`)
*   *Pedidos simulados*: `LOJA-B-001` até `LOJA-B-007`.

| E-mail | Senha | Papel | Web Dashboard | App Mobile |
| :--- | :--- | :--- | :--- | :--- |
| `admin@loja-b.local` | `admin123` | Tenant Admin (`ADMIN`) | Sim | Sim |
| `picker@loja-b.local` | `dev` | Separador (`PICKER`) | Não | Sim |

### Loja Demo C (`demo-loja-c`)
*   *Pedidos simulados*: `LOJA-C-001` até `LOJA-C-007`.

| E-mail | Senha | Papel | Web Dashboard | App Mobile |
| :--- | :--- | :--- | :--- | :--- |
| `admin@loja-c.local` | `admin123` | Tenant Admin (`ADMIN`) | Sim | Sim |
| `picker@loja-c.local` | `dev` | Separador (`PICKER`) | Não | Sim |

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
