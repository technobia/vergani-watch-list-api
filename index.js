import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('/*', cors());

const shopifyGraphQL = async (env, query, variables = {}) => {
  const store = env.SHOPIFY_STORE_URL;
  const version = env.SHOPIFY_API_VERSION || '2024-10';
  const url = `https://${store}/admin/api/${version}/graphql.json`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env.SHOPIFY_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data;
};

const getWatchList = async (env, companyLocationId) => {
  const query = `
    query getCompanyLocation($id: ID!) {
      companyLocation(id: $id) {
        id
        metafield(namespace: "custom", key: "watch_list") {
          value
        }
      }
    }
  `;

  const result = await shopifyGraphQL(env, query, {
    id: companyLocationId,
  });

  const metafieldValue = result.data?.companyLocation?.metafield?.value;
  return metafieldValue ? JSON.parse(metafieldValue) : [];
};

const updateWatchList = async (env, companyLocationId, watchList) => {
  const mutation = `
    mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const result = await shopifyGraphQL(env, mutation, {
    metafields: [
      {
        ownerId: companyLocationId,
        namespace: 'custom',
        key: 'watch_list',
        value: JSON.stringify(watchList),
        type: 'list.product_reference',
      },
    ],
  });

  if (result.data?.metafieldsSet?.userErrors?.length > 0) {
    throw new Error(`Metafield update errors: ${JSON.stringify(result.data.metafieldsSet.userErrors)}`);
  }

  return result;
};

app.post('/api/watchlist/add', async (c) => {
  try {
    const { companyLocationId, productId } = await c.req.json();

    if (!companyLocationId || !productId) {
      return c.json({ error: 'companyLocationId and productId are required' }, 400);
    }

    const watchList = await getWatchList(c.env, companyLocationId);

    if (watchList.includes(productId)) {
      return c.json({
        message: 'Product already in watch list',
        watchList,
      });
    }

    watchList.push(productId);
    await updateWatchList(c.env, companyLocationId, watchList);

    return c.json({
      message: 'Product added to watch list',
      watchList,
    });
  } catch (error) {
    console.error('Error adding to watch list:', error);
    return c.json({ error: error.message }, 500);
  }
});

app.delete('/api/watchlist/remove', async (c) => {
  try {
    const { companyLocationId, productId } = await c.req.json();

    if (!companyLocationId || !productId) {
      return c.json({ error: 'companyLocationId and productId are required' }, 400);
    }

    const watchList = await getWatchList(c.env, companyLocationId);

    const index = watchList.indexOf(productId);
    if (index === -1) {
      return c.json({
        error: 'Product not found in watch list',
        watchList,
      }, 404);
    }

    watchList.splice(index, 1);
    await updateWatchList(c.env, companyLocationId, watchList);

    return c.json({
      message: 'Product removed from watch list',
      watchList,
    });
  } catch (error) {
    console.error('Error removing from watch list:', error);
    return c.json({ error: error.message }, 500);
  }
});

export default app;
