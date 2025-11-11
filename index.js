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

const normalizeProductId = (productId) => {
  if (typeof productId === 'string' && productId.startsWith('gid://shopify/Product/')) {
    return productId;
  }
  return `gid://shopify/Product/${productId}`;
};

const getWatchlistMetaobjectId = async (env, companyLocationId) => {
  const query = `
    query getCompanyLocation($id: ID!) {
      companyLocation(id: $id) {
        id
        metafield(namespace: "custom", key: "watch_list_object") {
          value
        }
      }
    }
  `;

  const result = await shopifyGraphQL(env, query, { id: companyLocationId });
  return result.data?.companyLocation?.metafield?.value || '';
};

const getWatchlistMetaobject = async (env, metaobjectId) => {
  const query = `
    query getMetaobject($id: ID!) {
      metaobject(id: $id) {
        id
        handle
        type
        fields {
          key
          value
        }
      }
    }
  `;

  const result = await shopifyGraphQL(env, query, { id: metaobjectId });
  return result.data?.metaobject || null;
};

const parseWatchlistProducts = (metaobject) => {
  if (!metaobject?.fields) {
    return [];
  }

  const watchlistField = metaobject.fields.find((field) => field.key === 'watchlist_products');
  if (!watchlistField?.value) {
    return [];
  }

  try {
    const products = JSON.parse(watchlistField.value);
    return Array.isArray(products) ? products.map(normalizeProductId) : [];
  } catch (error) {
    console.error('Failed to parse watchlist products:', error);
    return [];
  }
};

const createWatchlistMetaobject = async (env, companyLocationId) => {
  const mutation = `
    mutation createWatchlist($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
          handle
          type
          fields {
            key
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const result = await shopifyGraphQL(env, mutation, {
    metaobject: {
      type: 'watchlist',
      fields: [
        {
          key: 'company_location',
          value: companyLocationId,
        },
        {
          key: 'watchlist_products',
          value: '[]',
        },
      ],
    },
  });

  const userErrors = result.data?.metaobjectCreate?.userErrors;
  if (userErrors?.length > 0) {
    throw new Error(`Failed to create watchlist: ${JSON.stringify(userErrors)}`);
  }

  const metaobject = result.data?.metaobjectCreate?.metaobject;

  await linkWatchlistToCompanyLocation(env, companyLocationId, metaobject.id);

  return metaobject;
};

const linkWatchlistToCompanyLocation = async (env, companyLocationId, metaobjectId) => {
  const mutation = `
    mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
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
        key: 'watch_list_object',
        value: metaobjectId,
        type: 'metaobject_reference',
      },
    ],
  });

  const userErrors = result.data?.metafieldsSet?.userErrors;
  if (userErrors?.length > 0) {
    throw new Error(`Failed to link watchlist to company location: ${JSON.stringify(userErrors)}`);
  }

  return result.data?.metafieldsSet?.metafields?.[0];
};

const getWatchlistData = async (env, companyLocationId, createIfMissing = false) => {
  const metaobjectId = await getWatchlistMetaobjectId(env, companyLocationId);

  if (!metaobjectId) {
    if (createIfMissing) {
      const metaobject = await createWatchlistMetaobject(env, companyLocationId);
      return { metaobject, watchlist: [] };
    }
    return { error: 'Watchlist not found for this company location', status: 404 };
  }

  const metaobject = await getWatchlistMetaobject(env, metaobjectId);
  if (!metaobject) {
    return { error: 'Watchlist metaobject not found', status: 404 };
  }

  const watchlist = parseWatchlistProducts(metaobject);
  return { metaobject, watchlist };
};

const updateWatchlistMetaobject = async (env, metaobject, products) => {
  const mutation = `
    mutation upsertWatchlist($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject {
          id
          handle
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  if (!metaobject?.handle || !metaobject?.type) {
    throw new Error('Metaobject handle or type missing');
  }

  const result = await shopifyGraphQL(env, mutation, {
    handle: {
      handle: metaobject.handle,
      type: metaobject.type,
    },
    metaobject: {
      fields: [
        {
          key: 'watchlist_products',
          value: JSON.stringify(products),
        },
      ],
    },
  });

  const userErrors = result.data?.metaobjectUpsert?.userErrors;
  if (userErrors?.length > 0) {
    throw new Error(`Failed to update watchlist: ${JSON.stringify(userErrors)}`);
  }

  return result.data?.metaobjectUpsert?.metaobject;
};

app.post('/api/watchlist/add', async (c) => {
  try {
    const { companyLocationId, productId } = await c.req.json();

    if (!companyLocationId || !productId) {
      return c.json({ error: 'companyLocationId and productId are required' }, 400);
    }

    const data = await getWatchlistData(c.env, companyLocationId, true);
    if (data.error) {
      return c.json({ error: data.error }, data.status);
    }

    const { metaobject, watchlist } = data;
    const normalizedProductId = normalizeProductId(productId);

    if (watchlist.includes(normalizedProductId)) {
      return c.json({
        message: 'Product already in watchlist',
        watchlist,
      });
    }

    watchlist.push(normalizedProductId);
    await updateWatchlistMetaobject(c.env, metaobject, watchlist);

    return c.json({
      message: 'Product added to watchlist',
      watchlist,
    });
  } catch (error) {
    console.error('Error adding to watchlist:', error);
    return c.json({ error: error.message }, 500);
  }
});

app.delete('/api/watchlist/remove', async (c) => {
  try {
    const { companyLocationId, productId } = await c.req.json();

    if (!companyLocationId || !productId) {
      return c.json({ error: 'companyLocationId and productId are required' }, 400);
    }

    const data = await getWatchlistData(c.env, companyLocationId);
    if (data.error) {
      return c.json({ error: data.error }, data.status);
    }

    const { metaobject, watchlist } = data;
    const normalizedProductId = normalizeProductId(productId);

    const index = watchlist.indexOf(normalizedProductId);
    if (index === -1) {
      return c.json({
        error: 'Product not found in watchlist',
        watchlist,
      }, 404);
    }

    watchlist.splice(index, 1);
    await updateWatchlistMetaobject(c.env, metaobject, watchlist);

    return c.json({
      message: 'Product removed from watchlist',
      watchlist,
    });
  } catch (error) {
    console.error('Error removing from watchlist:', error);
    return c.json({ error: error.message }, 500);
  }
});

app.post('/api/watchlist/reorder', async (c) => {
  try {
    const { companyLocationId, orderedProductIds } = await c.req.json();

    if (!companyLocationId || !orderedProductIds || !Array.isArray(orderedProductIds)) {
      return c.json({ error: 'companyLocationId and orderedProductIds (array) are required' }, 400);
    }

    const data = await getWatchlistData(c.env, companyLocationId);
    if (data.error) {
      return c.json({ error: data.error }, data.status);
    }

    const { metaobject, watchlist: currentWatchlist } = data;
    const normalizedProductIds = orderedProductIds.map((id) => normalizeProductId(id));

    const currentSet = new Set(currentWatchlist);
    const newSet = new Set(normalizedProductIds);

    if (currentSet.size !== newSet.size || !normalizedProductIds.every((id) => currentSet.has(id))) {
      return c.json({
        error: 'Ordered product IDs must match existing watchlist items',
        currentWatchlist,
      }, 400);
    }

    await updateWatchlistMetaobject(c.env, metaobject, normalizedProductIds);

    return c.json({
      message: 'Watchlist reordered successfully',
      watchlist: normalizedProductIds,
    });
  } catch (error) {
    console.error('Error reordering watchlist:', error);
    return c.json({ error: error.message }, 500);
  }
});

export default app;
