
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const fetchAllShopifyProducts = async (connection) => {
    console.log("Start fetching Shopify products...");
    try {
        let hasNextPage = true;
        let cursor = null;

        while (hasNextPage) {
            const query = `query ($cursor: String) {
                products(first: 250, after: $cursor) {
                    edges {
                        cursor
                        node {
                            id
                            title
                            handle
                            vendor
                            productType
                            descriptionHtml
                            tags
                            variants(first: 10) {
                                edges {
                                    node {
                                        id
                                        title
                                        price
                                        sku
                                        inventoryQuantity
                                        inventoryManagement
                                        requiresShipping
                                        weight
                                        weightUnit
                                        taxable
                                        compareAtPrice
                                        inventoryItem {
                                            id
                                        }
                                    }
                                }
                            }
                            options {
                                id
                                name
                                values
                            }
                            images(first: 10) {
                                edges {
                                    node {
                                        id
                                        src
                                        altText
                                    }
                                }
                            }
                            metafields(first: 10) {
                                edges {
                                    node {
                                        namespace
                                        key
                                        value
                                    }
                                }
                            }
                        }
                    }
                    pageInfo {
                        hasNextPage
                    }
                }
            }`;

            let response;
            try {
                response = await axios.post(
                    process.env.SHOPIFY_GRAPHQL_URL,
                    { query, variables: { cursor } },
                    { headers: { 'X-Shopify-Access-Token': process.env.ACCESS_SHOPIFY, 'Content-Type': 'application/json' } }
                );
            } catch (error) {
                console.error("❌ Erreur de requête Shopify:", error.message);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Pause avant de réessayer
                continue;
            }

            const data = response.data.data.products;
            hasNextPage = data.pageInfo.hasNextPage;
            if (hasNextPage) cursor = data.edges[data.edges.length - 1].cursor;

            try {
                for (const edge of data.edges) {
                    const productNode = edge.node;
                    const metafield = productNode.metafields.edges.find(m => m.node.key === "prd_id");
                    const prd_id = metafield ? metafield.node.value : null;

                    // 🔹 Vérifier si le produit existe déjà en base
                    const [existingProduct] = await connection.execute(
                        `SELECT id, title FROM products WHERE shopifyId = ?`,
                        [productNode.id]
                    );

                    let productId = existingProduct.length > 0 ? existingProduct[0].id : null;
                    if (!productId) {
                        // 🔹 Le produit n'existe pas, on l'insère
                        const [insertResult] = await connection.execute(
                            `INSERT INTO products (shopifyId, title, handle, vendor, productType, descriptionHtml, tags, prd_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                productNode.id,
                                productNode.title,
                                productNode.handle,
                                productNode.vendor,
                                productNode.productType,
                                productNode.descriptionHtml,
                                JSON.stringify(productNode.tags),
                                prd_id
                            ]
                        );
                        productId = insertResult.insertId; // Récupérer l'ID du produit inséré
                    }

                    if (productId) {

                        if (existingProduct.length > 0 && existingProduct[0].title != productNode.title) {
                            `UPDATE products SET title = ?, handle = ?, vendor = ?, productType = ?, descriptionHtml = ?, tags = ?
                                WHERE shopifyId = ?`,
                                [
                                    productNode.title,
                                    productNode.handle,
                                    productNode.vendor,
                                    productNode.productType,
                                    productNode.descriptionHtml,
                                    JSON.stringify(productNode.tags),
                                    productNode.id
                                ]
                        }
                        // 🔹 Vérifier et mettre à jour les variantes
                        for (const variantEdge of productNode.variants.edges) {
                            const variant = variantEdge.node;

                            // Vérifier si la variante existe déjà en base
                            const [existingVariant] = await connection.execute(
                                `SELECT inventoryQuantity FROM variants WHERE shopifyId = ?`,
                                [variant.id]
                            );

                            if (existingVariant.length > 0) {
                                const dbQuantity = existingVariant[0].inventoryQuantity;

                                if (dbQuantity !== variant.inventoryQuantity) {
                                    // 🔹 Mettre à jour uniquement la quantité si elle est différente
                                    await connection.execute(
                                        `UPDATE variants SET inventoryQuantity = ? WHERE shopifyId = ?`,
                                        [variant.inventoryQuantity, variant.id]
                                    );
                                }
                            } else {
                                // 🔹 Insérer la variante si elle n'existe pas
                                await connection.execute(
                                    `INSERT INTO variants (shopifyId, productId, title, price, sku, inventoryQuantity, 
                                        inventoryManagement, requiresShipping, weight, weightUnit, taxable, compare_at_price, inventory_item_id)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                    [
                                        variant.id,
                                        productId,
                                        variant.title,
                                        variant.price,
                                        variant.sku,
                                        variant.inventoryQuantity,
                                        variant.inventoryManagement,
                                        variant.requiresShipping,
                                        variant.weight,
                                        variant.weightUnit,
                                        variant.taxable,
                                        variant.compareAtPrice,
                                        variant.inventoryItem?.id || null
                                    ]
                                );
                            }
                        }

                        // 🔹 Insérer/MàJ les métachamps
                        for (const metafieldEdge of productNode.metafields.edges) {
                            const metafield = metafieldEdge.node;
                            await connection.execute(
                                `INSERT INTO metafields (productId, namespace, key_name, value)
                                 VALUES (?, ?, ?, ?)
                                 ON DUPLICATE KEY UPDATE value = VALUES(value)`,
                                [productId, metafield.namespace, metafield.key, metafield.value]
                            );
                        }
                    }
                }
            } catch (dbError) {
                console.error("❌ Erreur BDD:", dbError);
            }

            console.log(`✅ Synchronisation de ${data.edges.length} produits terminée.`);
            await new Promise(resolve => setTimeout(resolve, 500)); // Pause pour éviter les limites Shopify
        }
    } catch (error) {
        console.log("❌ Erreur principale:", error.message);
    }
};

export default fetchAllShopifyProducts;