# Comparador de Casas (Portugal)

MVP para procurar casas em várias fontes ao mesmo tempo, com filtros de:
- zonas
- quartos mínimos
- preço máximo
- tipo de negócio (compra/arrendamento)

## Como correr

1. Instalar dependências:

```bash
npm install
```

2. Iniciar o servidor:

```bash
npm run dev
```

3. Abrir no browser:

```text
http://localhost:3000
```

## Estrutura

- `server.js`: API + servidor web
- `public/`: frontend
- `src/providers/`: conectores de cada fonte/site

## Como ligar sites reais

Neste MVP, os providers usam dados de exemplo (`src/providers/baseData.js`).

Para ligar uma fonte real:

1. Cria/edita um provider em `src/providers/`.
2. No método `search(filters)`, faz pedido HTTP para a API oficial da plataforma (quando existir) e devolve dados normalizados.
3. Regista o provider em `src/providers/index.js`.

Formato esperado de cada casa:

```js
{
  id: "fonte-id",
  source: "Nome da Fonte",
  title: "Título",
  zone: "Zona/Freguesia",
  city: "Cidade",
  rooms: 2,
  price: 250000,
  listingType: "buy", // ou "rent"
  url: "https://..."
}
```

## Nota legal

Antes de fazer scraping de qualquer site, confirma sempre os Termos de Utilização e `robots.txt`.
