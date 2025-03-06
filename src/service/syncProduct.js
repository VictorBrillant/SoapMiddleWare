
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

async function getLocations() {
	const locationsQuery = {
		query: `
        query {
          locations(first: 10) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      `
	};

	try {
		const response = await axios.post(process.env.SHOPIFY_GRAPHQL_URL, locationsQuery, {
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': process.env.ACCESS_SHOPIFY
			}
		});
		
		const locationId = response.data.data.locations.edges[0].node.id; // Get the first location ID (or customize as needed)
		return locationId;
	} catch (error) {
		console.error("Error fetching locations:", error.response?.data || error.message);
		throw new Error('Failed to fetch locations');
	}
}
  

async function processProductsInBatches(products, connection, batchSize = 10) {
	for (let i = 0; i < products.length; i += batchSize) {
		const batch = products.slice(i, i + batchSize);
		if (process.env.NODE_ENV === "development") {
			console.log(`Processing batch ${i / batchSize + 1}...`);
		}


		await Promise.all(batch.map(async (product) => {
			try {
				const [[existingProductInShopify]] = await connection.execute(
					`SELECT * FROM products WHERE prd_id = ?`,
					[product.prd_id]
				);

				const productId = existingProductInShopify?.id;
				
				if (productId) {
					const [existingVariantsInSoap] = await connection.execute(
						`SELECT * FROM stock_variants WHERE prd_id = ?`,
						[product.prd_id]
					);
					
					if (existingProductInShopify.title == product.prd_id) {
						if (process.env.NODE_ENV === "development") {
							console.log(`Updating product ${productId} in Shopify...`);
						}
						
						// Prepare update payload
						const updatePayload = {
							input: {
								id: existingProductInShopify?.shopifyId,
								title: product.prd_libel || product.prd_id,
								bodyHtml: product.prd_large_description
							}
						};

						const [listVariant] = await connection.execute(
							`SELECT * FROM variants WHERE productId = ?`,
							[productId]
						);

						// Update product in Shopify
						await updateProductInShopify(updatePayload, listVariant, product);

					}

					await Promise.all(existingVariantsInSoap.map(async (soapVariant) => {
						try {
							const [[existingVariantInShopify]] = await connection.execute(
								`SELECT * FROM variants WHERE productId = ? AND sku = ?`,
								[productId, soapVariant.stock_ean13]
							);

							if (!existingVariantInShopify) {
								if (process.env.NODE_ENV === "development") {
									console.log(`Creating variant for product ${productId}`);
								}

								await createVariant(productId, soapVariant);
							} else if (existingVariantInShopify.inventoryQuantity !== soapVariant.stock_qt) {
								if (process.env.NODE_ENV === "development") {
									console.log(`Updating inventory for ${soapVariant.stock_ean13}`);
								}
								const shopifyQuantity = parseInt(soapVariant.stock_qt, 10) - parseInt(existingVariantInShopify.inventoryQuantity, 10);
								await adjustInventoryQuantity(existingVariantInShopify.inventory_item_id, shopifyQuantity, existingVariantInShopify.sku, connection, existingVariantInShopify.shopifyId);
							}
						} catch (variantError) {
							console.error(`Error processing variant ${soapVariant.stock_ean13}:`, variantError.message);
						}
					}));
				} else {
					try {
						if (process.env.NODE_ENV === "development") {
							console.log(`Syncing product ${product.prd_id} to Shopify...`);
						}
						await syncProductToShopify(product, connection);
					} catch (syncError) {
						console.error(`Error syncing product ${product.prd_id} to Shopify:`, syncError.message);
					}
				}
			} catch (productError) {
				console.error(`Error processing product ${product.prd_id}:`, productError.message);
			}
		}));

		console.log(`Batch ${i / batchSize + 1} completed.`);
		await new Promise(resolve => setTimeout(resolve, 2000)); // Pause pour éviter le throttle
	}
}

async function updateProductInShopify(payload, existingVariantsInShopify, existingProductInSoap) {
        const graphqlQueryUpdate = {
            query: `
                mutation updateProduct($input: ProductInput!) {
                    productUpdate(input: $input) {
                        product {
                            id
                            title
                            bodyHtml
                        }
                        userErrors {
                            field
                            message
                        }
                    }
                }
            `,
            variables: {
                input: payload.input  // Correction ici
            }
        };

        try {
            await axios.post(process.env.SHOPIFY_GRAPHQL_URL, graphqlQueryUpdate, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': process.env.ACCESS_SHOPIFY
                }
            });

            for(const matchingSoapVariant of existingVariantsInShopify){
                const variantPayload = {
                    input: {
                        id: matchingSoapVariant.shopifyId,
                        price: existingProductInSoap.prd_px_euro
                    }
                };

                const graphqlQueryUpdateVariant = {
                    query: `
                        mutation updateVariant($input: ProductVariantInput!) {
                            productVariantUpdate(input: $input) {
                                productVariant {
                                    id
                                    sku
                                    price
                                }
                                userErrors {
                                    field
                                    message
                                }
                            }
                        }
                    `,
                    variables: {
                        input: variantPayload.input
                    }
                };

                try {
                    await axios.post(process.env.SHOPIFY_GRAPHQL_URL, graphqlQueryUpdateVariant, {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Shopify-Access-Token': process.env.ACCESS_SHOPIFY
                        }
                    });

                } catch (error) {
                    console.log(`Error updating variant ${shopifyVariant.sku}:`, error.message);
                }
            }
        } catch (error) {
            console.log('Updating product error: ', error.message)
        }
}

const syncProducts = async (connection) => {
	console.log("Start synchronisation...");
	try {
		const [existingProductsInSoap] = await connection.execute(
			`SELECT * FROM product_info`
		);

		await processProductsInBatches(existingProductsInSoap, connection, 10);
	} catch (error) {
		console.log(error.message);
	} finally {
		console.log("End synchronisation...")
	}

	console.log("Synchronization finished.");
};

//UPDATE EXISTING PRODUCT IN SHOPIFY
async function updateInventoryQuantity(inventoryItemId, quantity) {
	const locationId = await getLocations();  // Get the location ID dynamically
	const inventoryMutation = {
		query: `
        mutation inventorySetOnHandQuantities($input: InventorySetOnHandQuantitiesInput!) {
            inventorySetOnHandQuantities(input: $input) {
                userErrors {
                    field
                    message
                }
                inventoryAdjustmentGroup {
                    createdAt
                    reason
                    referenceDocumentUri
                    changes {
                        name
                        delta
                    }
                }
            }
        }
      `,
		variables: {
			input: {
				setQuantities: [
					{
						inventoryItemId,
						locationId,
						quantity  // Ensure the quantity is valid
					}
				],
				reason: "movement_updated"
			}
		}
	};

	try {
		const response = await axios.post(process.env.SHOPIFY_GRAPHQL_URL, inventoryMutation, {
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': process.env.ACCESS_SHOPIFY
			}
		});

		if (response.data?.data?.inventorySetOnHandQuantities?.userErrors.length > 0) {
			console.error("Shopify User Errors Update Quantity:", response.data.data.inventorySetOnHandQuantities.userErrors);
		}
	} catch (error) {
		console.error("Error updating inventory:", error.response?.data || error.message);
	}
}

async function updateVariantInventoryManagement(variantId, inventoryItemId, locationId) {
    const mutation = {
        query: `
            mutation productVariantUpdate($input: ProductVariantInput!) {
                productVariantUpdate(input: $input) {
                    productVariant {
                        id
                        inventoryManagement
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }
        `,
        variables: {
            input: {
                id: variantId,
                inventoryManagement: "SHOPIFY" // Switch to Shopify-managed inventory
            }
        }
    };

    try {
        const response = await axios.post(process.env.SHOPIFY_GRAPHQL_URL, mutation, {
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': process.env.ACCESS_SHOPIFY
            }
        });

        console.log("Updated Variant:", response.data);
		await activateInventoryAtLocation(inventoryItemId, locationId)
        return response.data;
    } catch (error) {
        console.error("Error updating variant inventory management:", error.response?.data || error.message);
    }
}



async function activateInventoryAtLocation(inventoryItemId, locationId) {
    const mutation = {
        query: `
            mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!) {
                inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
                    userErrors {
                        field
                        message
                    }
                }
            }
        `,
        variables: { inventoryItemId, locationId }
    };

    try {
        const response = await axios.post(process.env.SHOPIFY_GRAPHQL_URL, mutation, {
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': process.env.ACCESS_SHOPIFY
            }
        });

        if (response.data?.data?.inventoryActivate?.userErrors?.length > 0) {
            console.error("Shopify User Errors Activate Inventory:", response.data.data.inventoryActivate.userErrors);
            return false;
        }

        console.log(`✅ Inventory item ${inventoryItemId} is now stocked at location ${locationId}`);
        return true;
    } catch (error) {
        console.error("Error activating inventory:", error.response?.data || error.message);
        return false;
    }
}

async function getVariantFulfillmentService(variantId) {
    const query = {
        query: `
            query getVariantFulfillment($id: ID!) {
                productVariant(id: $id) {
                    id
                    fulfillmentService {
                        type
                    }
                    inventoryManagement
                }
            }
        `,
        variables: {
            id: variantId
        }
    };

    try {
        const response = await axios.post(process.env.SHOPIFY_GRAPHQL_URL, query, {
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": process.env.ACCESS_SHOPIFY
            }
        });

        const variant = response.data?.data?.productVariant;
        if (!variant) {
            console.error("Variant not found.");
            return null;
        }

        return {
            fulfillmentService: variant.fulfillmentService?.type,
            inventoryManagement: variant.inventoryManagement
        };
    } catch (error) {
        console.error("Error fetching variant fulfillment service:", error.response?.data || error.message);
        return null;
    }
}

async function updateVariantFulfillmentService(variantId) {
    const mutation = {
        query: `
            mutation updateVariantFulfillment($input: ProductVariantInput!) {
                productVariantUpdate(input: $input) {
                    productVariant {
                        id
                        fulfillmentService {
                            type
                        }
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }
        `,
        variables: {
            input: {
                id: variantId,
                fulfillmentService: { type: "MANUAL" } // Change to manual fulfillment
            }
        }
    };

    try {
        const response = await axios.post(process.env.SHOPIFY_GRAPHQL_URL, mutation, {
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": process.env.ACCESS_SHOPIFY
            }
        });

        console.log(response.data);
        if (response.data?.data?.productVariantUpdate?.userErrors?.length > 0) {
            console.error("Shopify User Errors:", response.data.data.productVariantUpdate.userErrors);
            return false;
        }

        return true;
    } catch (error) {
        console.error("Error updating fulfillment service:", error.response?.data || error.message);
        return false;
    }
}


//ADJUST EXISTING VARIANT QUANTITY
async function adjustInventoryQuantity(inventoryItemId, quantity, sku, connection, variantId) {
	const locationId = await getLocations();
	const [[productSoap]] = await connection.execute(
		'SELECT prd_id FROM stock_variants WHERE stock_ean13 = ?',
		[
			sku
		]
	)
	
	if(productSoap){
		await updateVariantInventoryManagement(variantId, inventoryItemId, locationId)
		
		const inventoryMutation = {
			query: `
		  mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
			inventoryAdjustQuantities(input: $input) {
			  userErrors {
				field
				message
			  }
			  inventoryAdjustmentGroup {
				createdAt
				reason
				referenceDocumentUri
				changes {
				  name
				  delta
				}
			  }
			}
		  }
		`,
			variables: {
				input: {
					name: "available", // Specify the inventory state
					reason: "correction",
					changes: [
						{
							inventoryItemId,
							locationId, 
							delta: quantity
						}
					]
				}
			}
		};
	
		try {
			const response = await axios.post(process.env.SHOPIFY_GRAPHQL_URL, inventoryMutation, {
				headers: {
					'Content-Type': 'application/json',
					'X-Shopify-Access-Token': process.env.ACCESS_SHOPIFY
				}
			});
	
			if (response.data?.data?.inventoryAdjustQuantities?.userErrors?.length > 0) {
				console.error("Shopify User Errors Adjust Quantity:", response.data.data.inventoryAdjustQuantities.userErrors);
			}
		} catch (error) {
			console.error("Error updating inventory:", error.response?.data || error.message);
		}
	}
}

//CREATE A NEW VARIANT
async function createVariant(productId, variantData) {
	const mutation = {
		query: `
          mutation createProductVariant($input: ProductVariantInput!) {
              productVariantCreate(input: $input) {
                  productVariant {
                      id
                      sku
                  }
                  userErrors {
                      field
                      message
                  }
              }
          }
      `,
		variables: {
			input: {
				productId,
				sku: variantData.stock_ean13,
				price: variantData.stock_px_euro,
				inventoryManagement: "SHOPIFY",
				inventoryPolicy: "CONTINUE",
				options: [variantData.stock_taille, variantData.stock_couleur]
			}
		}
	};

	try {
		const response = await axios.post(process.env.SHOPIFY_GRAPHQL_URL, mutation, {
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': process.env.ACCESS_SHOPIFY
			}
		});

		if (response.data?.data?.productVariantCreate?.userErrors.length > 0) {
			console.error("Shopify User Errors Create Variants:", response.data.data.productVariantCreate.userErrors);
		}
	} catch (error) {
		console.error("Error creating variant:", error.response?.data || error.message);
	}
}

//CREATE NEW PRODUCT IN SHOPIFY
async function syncProductToShopify(productData, connection) {

	const [existingVariantsInSoap] = await connection.execute(
		`SELECT * FROM stock_variants WHERE prd_id = ?`,
		[productData.prd_id]
	)

	const [existingOptionsInSoap] = await connection.execute(
		`SELECT * 
            FROM product_options AS A 
            LEFT JOIN option_values AS B ON A.id = B.optionId 
            WHERE A.prd_id = ?`,
		[productData.prd_id]
	)

	const groupedOptions = existingOptionsInSoap.reduce((acc, option) => {
		const existingOption = acc.find(o => o.id === option.optionId);

		if (existingOption) {
			existingOption.values.push(option.label);
		} else {
			acc.push({
				id: option.optionId,
				name: option.option_name,
				values: [option.label]
			});
		}

		return acc;
	}, []);

	try {
		// Define the GraphQL mutation for creating the product
		const graphqlQueryCreate = {
			query: `
            mutation createProduct($input: ProductInput!) {
            productCreate(input: $input) {
                product {
                id
                title
                metafields(first: 10) {
                    edges {
                    node {
                        id
                        namespace
                        key
                        value
                    }
                    }
                }
                variants(first: 10) {
                    edges {
                    node {
                        id
                        sku
                        price
                        inventoryItem {
                        id
                        tracked
                        }
                    }
                    }
                }
                }
                userErrors {
                field
                message
                }
            }
            }
        `,
			variables: {
				input: {
					title: productData.prd_libel || productData.prd_id,
					bodyHtml: productData.prd_large_description,
					variants: existingVariantsInSoap.map(variant => ({
						sku: variant.stock_ean13,
						price: productData.prd_px_euro,
						inventoryManagement: "SHOPIFY",
						inventoryPolicy: "CONTINUE",
						options: [variant.stock_taille, variant.stock_couleur]
					})),
					options: groupedOptions.map(option => option.name),
					metafields: [
						{
							namespace: "custom",
							key: "prd_id",
							value: productData.prd_id,
							type: "single_line_text_field"
						}
					]
				}
			}
		};

		// Send request to create product
		const response = await axios.post(process.env.SHOPIFY_GRAPHQL_URL, graphqlQueryCreate, {
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': process.env.ACCESS_SHOPIFY
			}
		});

		const createdProduct = response.data?.data?.productCreate?.product;
		const userErrors = response.data?.data?.productCreate?.userErrors;

		if (userErrors?.length > 0) {

			console.error("Shopify User Errors Sync Product:", userErrors);
			throw new Error("Shopify returned user errors.");
		}

		if (!createdProduct) {
			throw new Error("Failed to retrieve created product.");
		}

		if (process.env.NODE_ENV === "development") {
			console.log(`Product created with ID: ${createdProduct.id}`);
		}
		await new Promise(resolve => setTimeout(resolve, 2000));

		// Handle metafields
		if (createdProduct.metafields?.edges) {
			createdProduct.metafields.edges.forEach(metafieldEdge => {
				const metafield = metafieldEdge.node;
			});
		} else {
			console.log("No metafields were created or returned.");
		}

		// Handle variants
		if (createdProduct.variants?.edges) {
			for (const variantEdge of createdProduct.variants.edges) {
				const variant = variantEdge.node;
				const inventoryItemId = variant.inventoryItem?.id;

				if (inventoryItemId) {
					const [[variantData]] = await connection.execute(
						`SELECT * FROM stock_variants WHERE stock_ean13 = ?`,
						[variant.sku]
					)
					if (variantData) {
						await updateInventoryQuantity(inventoryItemId, parseInt(variantData.stock_qt, 10));
					}
				}
			}

		}

		// Now that the product is created, update the product metafields if needed
		if (createdProduct.id) {
			const graphqlQueryUpdate = {
				query: `
            mutation updateProduct($input: ProductInput!) {
                productUpdate(input: $input) {
                product {
                    metafields(first: 100) {
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
            }
            `,
				variables: {
					input: {
						id: createdProduct.id,
						metafields: [
							{
								namespace: "custom",
								key: "prd_id",
								value: productData.prd_id,
								type: "single_line_text_field"
							}
						]
					}
				}
			};

			// Send request to update product metafields
			const metafield1 = await axios.post(process.env.SHOPIFY_GRAPHQL_URL, graphqlQueryUpdate, {
				headers: {
					'Content-Type': 'application/json',
					'X-Shopify-Access-Token': process.env.ACCESS_SHOPIFY
				}
			});

			if (process.env.NODE_ENV === "development") {
				console.log(`Product metafield updated with prd_id: ${productData.prd_id}`);
			}
		}

		return 0;

	} catch (error) {
		console.error('Error syncing product:', error.response?.data || error.message);
		throw new Error('Failed to sync product to Shopify');
	}
}
//const connection = await pool.getConnection();
//syncProducts(connection)
export default syncProducts