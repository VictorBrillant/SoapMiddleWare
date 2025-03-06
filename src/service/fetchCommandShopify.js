import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const SHOPIFY_GRAPHQL_URL = process.env.SHOPIFY_GRAPHQL_URL;
const ACCESS_TOKEN = process.env.ACCESS_SHOPIFY;

const fetchCommands = async (connection) => {
    let orders = [];
    let hasNextPage = true;
    let cursor = null;

    try {
        while (hasNextPage) {
            const query = {
                query: `
                  {
                    orders(first: 10, after: ${cursor ? `"${cursor}"` : null}) {
                        edges {
                            node {
                                id
                                name
                                email
                                totalPrice
                                createdAt
                                currencyCode
                                displayFinancialStatus
                                displayFulfillmentStatus
                                customer {
                                    firstName
                                    lastName
                                    phone
                                }
                                shippingAddress {
                                    address1
                                    address2
                                    city
                                    zip
                                    country
                                }
                                billingAddress {
                                    address1
                                    address2
                                    city
                                    zip
                                    country
                                }
                                lineItems(first: 10) {
                                    edges {
                                        node {
                                            id
                                            title
                                            quantity
                                            originalUnitPrice
                                            sku
                                        }
                                    }
                                }
                                metafields(first: 5) {
                                    edges {
                                        node {
                                            namespace
                                            key
                                            value
                                            type
                                        }
                                    }
                                }
                            }
                            cursor
                        }
                        pageInfo {
                            hasNextPage
            }
        }
    }


                `
            };

            const response = await axios.post(SHOPIFY_GRAPHQL_URL, query, {
                headers: {
                    'X-Shopify-Access-Token': ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            });

            // Vérifie la réponse de Shopify
           const data = response.data.data;
            if (!data || !data.orders) {
                throw new Error("Réponse invalide de Shopify");
            }

            // Ajoute les commandes à la liste
            orders = [...orders, ...data.orders.edges.map(edge => edge.node)];

            // Gestion de la pagination
            hasNextPage = data.orders.pageInfo.hasNextPage;
             if (hasNextPage) {
                 cursor = data.orders.edges[data.orders.edges.length - 1].cursor;
             }
        }

        for (const order of orders) {
            const [[existingOrderShopify]] = await connection.execute(
                `SELECT shopifyId FROM orders WHERE shopifyId = ?`,
                [order.id]
            );

            if(process.env.NODE_ENV === "development"){
                console.log("Fetch Shopify ID: ", order.id);
            }
            if (!existingOrderShopify) {
                try {
                    // Insérer la commande dans la base de données
                    await connection.execute(
                        `INSERT INTO orders (
                            shopifyId, name, email, total_price, currency_code, 
                            display_financial_status, display_fulfillment_status, created_at,
                            customer_first_name, customer_last_name, customer_phone,
                            shipping_address1, shipping_address2, shipping_city, shipping_zip, shipping_country,
                            billing_address1, billing_address2, billing_city, billing_zip, billing_country
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            order.id,                      
                            order.name || '',                    
                            order.email || '',                 
                            order.totalPrice || 0,            
                            order.currencyCode || '',
                            order.displayFinancialStatus || '',
                            order.displayFulfillmentStatus || '',
                            order.createdAt,
                            order.customer?.firstName || '',
                            order.customer?.lastName || '',
                            order.customer?.phone || '',
                            order.shippingAddress?.address1 || '',
                            order.shippingAddress?.address2 || '',
                            order.shippingAddress?.city || '',
                            order.shippingAddress?.zip || '',
                            order.shippingAddress?.country || '',
                            order.billingAddress?.address1 || '',
                            order.billingAddress?.address2 || '',
                            order.billingAddress?.city || '',
                            order.billingAddress?.zip || '',
                            order.billingAddress?.country || ''
                        ]
                    );

                    const orderId = order.id;
                    if(process.env.NODE_ENV === "development"){
                        console.log("Insert Shopify ID: ", order.id);
                    }

                    // Insérer les articles de la commande (line_items)
                    for (const lineItem of order.lineItems.edges) {
                       await connection.execute(
                            `INSERT INTO line_items (shopifyId, order_id, title, quantity, original_unit_price, sku)
                            VALUES (?, ?, ?, ?, ?, ?)`,
                            [
                                lineItem.node.id || '',
                                orderId,
                                lineItem.node.title || '',
                                lineItem.node.quantity || 0,
                                lineItem.node.originalUnitPrice || 0,
                                lineItem.node.sku || ''
                            ]
                        );
                    }

                    // Insérer les métadonnées (metafields)
                    for (const metafield of order.metafields.edges) {
                        await connection.execute(
                            `INSERT INTO metafields (order_id, namespace, key_name, value, type)
                            VALUES (?, ?, ?, ?, ?)`,
                            [
                                orderId,
                                metafield.node.namespace || '',
                                metafield.node.key || '',
                                metafield.node.value || '',
                                metafield.node.type || ''
                            ]
                        );
                    }

                } catch (error) {
                    console.log('fetch order error: ', error.message);
                }
            }
        }

    } catch (error) {
        console.log("Shopify: ", error.message);
    } 
};
export default fetchCommands;
