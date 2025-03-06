import dotenv from "dotenv";

dotenv.config();

const safeValue = (value) => (value !== undefined && value !== null ? value : null);

const fetchDataSoap = async (product, connection) => {
    try {
            try {
                const productInfo = product.productInfo || {};

                const [[existingProduct]] = await connection.execute(
                    `SELECT id, prd_libel FROM product_info WHERE prd_id = ?`,
                    [safeValue(product.stockItem.prd_id)]
                );

                let productId = existingProduct?.id || null;

                if (!productId) {
                    // Insert new product if it doesn't exist
                    const [insertResult] = await connection.execute(
                        `INSERT INTO product_info (prd_id, prd_libel, prd_small_description, prd_large_description, prd_px_euro, prd_px_promo, prd_px_pro, prd_canal_soft, prd_canal_femme, prd_poids, prd_categorie, prd_codebarre)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            safeValue(product.stockItem.prd_id),
                            safeValue(productInfo.prd_libel),
                            safeValue(productInfo.prd_small_description),
                            safeValue(productInfo.prd_large_description),
                            safeValue(productInfo.prd_px_euro),
                            safeValue(productInfo.prd_px_promo),
                            safeValue(productInfo.prd_px_pro),
                            safeValue(productInfo.prd_canal_soft),
                            safeValue(productInfo.prd_canal_femme),
                            safeValue(productInfo.prd_poids),
                            safeValue(productInfo.prd_categorie),
                            safeValue(productInfo.prd_codebarre),
                        ]
                    );
                    productId = insertResult.insertId;
                    if(process.env.NODE_ENV === "development"){
                        console.log("Inserted new product with ID:", productId);
                    }
                } else if (!existingProduct.prd_libel) {
                    // Update existing product if prd_libel is NULL
                    await connection.execute(
                        `UPDATE product_info 
                         SET prd_libel = ?, prd_small_description = ?, prd_large_description = ?, prd_px_euro = ?, prd_px_promo = ?, prd_px_pro = ?, prd_canal_soft = ?, prd_canal_femme = ?, prd_poids = ?, prd_categorie = ?, prd_codebarre = ? 
                         WHERE prd_id = ?`,
                        [
                            safeValue(productInfo.prd_libel),
                            safeValue(productInfo.prd_small_description),
                            safeValue(productInfo.prd_large_description),
                            safeValue(productInfo.prd_px_euro),
                            safeValue(productInfo.prd_px_promo),
                            safeValue(productInfo.prd_px_pro),
                            safeValue(productInfo.prd_canal_soft),
                            safeValue(productInfo.prd_canal_femme),
                            safeValue(productInfo.prd_poids),
                            safeValue(productInfo.prd_categorie),
                            safeValue(productInfo.prd_codebarre),
                            safeValue(product.stockItem.prd_id),
                        ]
                    );
                    if(process.env.NODE_ENV === "development"){
                        console.log("Updated product with ID:", productId);
                    } 
                }

                if (Array.isArray(product.variants)) {
                    await Promise.allSettled(product.variants.map(async (variant) => {
                        try {
                            const [[existingVariant]] = await connection.execute(
                                `SELECT stock_qt FROM stock_variants WHERE stock_ean13 = ?`,
                                [safeValue(variant.stock_ean13)]
                            );

                            if (existingVariant) {
                                if (existingVariant.stock_qt != variant.stock_qt) {
                                    if(process.env.NODE_ENV === "development"){
                                        console.log("Updating stock quantity for variant:", variant.stock_ean13, "variant in base: ", existingVariant.stock_qt, "variant from the api: ", variant.stock_qt);
                                    }
                                    await connection.execute(
                                        `UPDATE stock_variants SET stock_qt = ? WHERE stock_ean13 = ?`,
                                        [safeValue(variant.stock_qt), safeValue(variant.stock_ean13)]
                                    );
                                }
                            } else {
                                if(process.env.NODE_ENV === "development"){
                                    console.log("Inserting new variant for product:", productId, "EAN:", variant.stock_ean13);
                                }
                                
                                await connection.execute(
                                    `INSERT INTO stock_variants (prd_id, stock_ean13, stock_qt, stock_actif, stock_suivi, stock_taille, stock_couleur)
                                     VALUES (?, ?, ?, ?, ?, ?, ?)`,

                                    [
                                        safeValue(product.stockItem.prd_id),
                                        safeValue(variant.stock_ean13),
                                        safeValue(variant.stock_qt),
                                        safeValue(variant.stock_actif),
                                        safeValue(variant.stock_suivi),
                                        safeValue(variant.stock_taille),
                                        safeValue(variant.stock_couleur),
                                    ]
                                );
                            }
                        } catch (variantError) {
                            console.error("Error processing variant:", variant.stock_ean13, variantError);
                        }
                    }));
                }

                if (Array.isArray(product.options)) {
                    await Promise.allSettled(product.options.map(async (option) => {
                        try {
                            const [[existingOption]] = await connection.execute(
                                `SELECT id FROM product_options WHERE prd_id = ? AND option_name = ?`,
                                [safeValue(product.stockItem.prd_id), safeValue(option.name)]
                            );

                            let optionId = existingOption?.id || null;

                            if (!optionId) {
                                const [optionInsertResult] = await connection.execute(
                                    `INSERT INTO product_options (prd_id, option_name) VALUES (?, ?)`,
                                    [safeValue(product.stockItem.prd_id), safeValue(option.name)]
                                );
                                optionId = optionInsertResult.insertId;
                                if(process.env.NODE_ENV === "development"){
                                    console.log("Inserted new option with ID:", optionId, "for product:", productId);
                                }  
                            }

                            if (Array.isArray(option.values)) {
                                await Promise.all(option.values.map(async (value) => {
                                    try {
                                        const [[existingValue]] = await connection.execute(
                                            `SELECT id FROM option_values WHERE optionId = ? AND label = ?`,
                                            [optionId, safeValue(value)]
                                        );

                                        if (!existingValue) {
                                            await connection.execute(
                                                `INSERT INTO option_values (optionId, label) VALUES (?, ?)`,
                                                [optionId, safeValue(value)]
                                            );
                                        }
                                    } catch (valueError) {
                                        console.error("Error processing option value:", value, valueError);
                                    }
                                }));
                            }
                        } catch (optionError) {
                            console.error("Error processing option:", option.name, optionError);
                        }
                    }));
                }
            } catch (productError) {
                console.error("Error processing product:", product.stockItem.prd_id, productError);
            }

    } catch (error) {
        console.error("Error in fetchDataSoap:", error);
    }
};

export default fetchDataSoap;
