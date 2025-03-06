import dotenv from 'dotenv';
import axios from 'axios';
import { DOMParser } from 'xmldom';
import { connectDB, pool } from "../config/db.js";
import iconv from 'iconv-lite';
import fetchDataSoap from './fetchDataSoap.js';

dotenv.config();

const apiLog = process.env.API_LOG;
const apiKey = process.env.API_KEY;
const actif = 1;
const SOAP_URL = process.env.SOAP_URL;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry (url, options, time, retries = 5) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), time); // Timeout de 30 secondes
            options.signal = controller.signal;

            const response = await fetch(url, options);
            clearTimeout(id);
            return response;
        } catch (error) {
            if (attempt === retries) throw error;
            console.log(`Retrying... (${attempt}/${retries})`);
            await delay(2000); // 2 secondes avant de réessayer
        }
    }
};

function transformStockList(stockList) {
    const transformedStockList = {};

    stockList.forEach(item => {
        const { prd_id, stock_ean13, stock_qt, stock_actif, stock_suivi, stock_taille, stock_couleur } = item;

        if (!transformedStockList[prd_id]) {
            transformedStockList[prd_id] = {
                prd_id: prd_id,
                variants: [],
                options: [] // Initialize the options array here
            };
        }

        transformedStockList[prd_id].variants.push({
            stock_ean13: stock_ean13,
            stock_qt: stock_qt,
            stock_actif: stock_actif,
            stock_suivi: stock_suivi,
            stock_taille: stock_taille,
            stock_couleur: stock_couleur
        });

        // Add size options
        if (stock_taille && !transformedStockList[prd_id].options.some(option => option.name === "Size")) {
            transformedStockList[prd_id].options.push({
                name: "Size",
                values: [...new Set(stockList.filter(item => item.prd_id === prd_id).map(i => i.stock_taille).filter(size => size))]
            });
        }

        // Add color options
        if (stock_couleur && !transformedStockList[prd_id].options.some(option => option.name === "Color")) {
            transformedStockList[prd_id].options.push({
                name: "Color",
                values: [...new Set(stockList.filter(item => item.prd_id === prd_id).map(i => i.stock_couleur).filter(color => color))]
            });
        }
    });

    return Object.values(transformedStockList);
}

async function getProductInfo(formatStockList, connection) {
    const batchSize = 10; // Process in small batches
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    const results = [];

    for (let i = 0; i < formatStockList.length; i += batchSize) {
        const batch = formatStockList.slice(i, i + batchSize);

       await Promise.allSettled(
            batch.map(async stockItem => {
                const prd_id = stockItem.prd_id;
                try {
                    // Direct SOAP request without using Express API
                    const headersList = {
                        "Accept": "*/*",
                        "Content-Type": "text/xml",
                        "SOAPAction": `${SOAP_URL}#GetProductInfo`
                    };

                    const bodyContent = `
                    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bus="${SOAP_URL}">
                        <soapenv:Header/>
                        <soapenv:Body>
                            <bus:GetProductInfo>
                                <api_log>${apiLog}</api_log>
                                <api_key>${apiKey}</api_key>
                                <product_id>${prd_id}</product_id>
                            </bus:GetProductInfo>
                        </soapenv:Body>
                    </soapenv:Envelope>`;

                    const response = await fetchWithRetry(`${SOAP_URL}`, {
                        method: "POST",
                        body: bodyContent,
                        headers: headersList
                    }, 2000);

                    const buffer = await response.arrayBuffer();
                    const decodedData = iconv.decode(Buffer.from(buffer), "ISO-8859-1");

                    // Parse the response XML
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(decodedData, "application/xml");

                    // Extract product data from SOAP response
                    const item = xmlDoc.getElementsByTagName("item")[0]; // Assuming one item per request

                    if (!item) {
                        console.warn(`No product data found for prd_id: ${prd_id}`);
                        return stockItem; // Return original if no data found
                    }

                    const productInfo = {
                        id_produit: item.getElementsByTagName("id_produit")[0]?.textContent,
                        prd_codebarre: item.getElementsByTagName("prd_codebarre")[0]?.textContent,
                        prd_libel: item.getElementsByTagName("prd_libel")[0]?.textContent,
                        prd_small_description: item.getElementsByTagName("prd_small_description")[0]?.textContent,
                        prd_large_description: item.getElementsByTagName("prd_large_description")[0]?.textContent,
                        prd_px_euro: item.getElementsByTagName("prd_px_euro")[0]?.textContent,
                        prd_px_promo: item.getElementsByTagName("prd_px_promo")[0]?.textContent,
                        prd_px_pro: item.getElementsByTagName("prd_px_pro")[0]?.textContent,
                        prd_canal_soft: item.getElementsByTagName("prd_canal_soft")[0]?.textContent,
                        prd_canal_femme: item.getElementsByTagName("prd_canal_femme")[0]?.textContent,
                        prd_poids: item.getElementsByTagName("prd_poids")[0]?.textContent,
                        prd_taux_tva: item.getElementsByTagName("prd_taux_tva")[0]?.textContent,
                        prd_categorie: item.getElementsByTagName("prd_categorie")[0]?.textContent,
                        prd_rep_img_40: item.getElementsByTagName("prd_rep_img_40")[0]?.textContent,
                        prd_rep_img_100: item.getElementsByTagName("prd_rep_img_100")[0]?.textContent,
                        prd_rep_img_300: item.getElementsByTagName("prd_rep_img_300")[0]?.textContent,
                        prd_rep_img_400: item.getElementsByTagName("prd_rep_img_400")[0]?.textContent,
                        prd_rep_img_800: item.getElementsByTagName("prd_rep_img_800")[0]?.textContent
                    };
                    if(process.env.NODE_ENV === "development"){
                        console.log(`Fetched product info for prd_id: ${prd_id}`);
                    }

                    const productData = {
                        stockItem,
                        productInfo,
                        variants: stockItem.variants.map(variant => ({ ...variant }))
                    }
                    
                    await fetchDataSoap(productData, connection);
                    

                    return 1;
                } catch (error) {
                    console.error(`Error fetching product info for prd_id ${prd_id}:`, error);
                    return 0; // Return the original item in case of an error
                }
            })
        );

        if(process.env.NODE_ENV === "development"){
            console.log(`Batch ${Math.ceil(i / batchSize) + 1} processed.`);
        }
        await delay(2000); // 2-second delay between batches
    }
    
    return results;
}

//WRITE IN products.json ALL PRODUCTS FROM THE SOAP API
async function fetchAndUpdateProductData(apiLog, apiKey, actif, connection) {
    const headersList = {
        "Accept": "*/*",
        "User-Agent": "Node Fetch",
        "Content-Type": "text/xml",
        "SOAPAction": `${SOAP_URL}#GetAllProductStock`
    };

    const bodyContent = `
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bus="${SOAP_URL}">
        <soapenv:Header/>
        <soapenv:Body>
            <bus:GetAllProductStock>
                <api_log>${apiLog}</api_log>
                <api_key>${apiKey}</api_key>
                <actif>${actif}</actif>
            </bus:GetAllProductStock>
        </soapenv:Body>
    </soapenv:Envelope>`;

    try {
        console.log("Fetching product stock data...");

        const response = await fetchWithRetry(`${SOAP_URL}`, {
            method: "POST",
            body: bodyContent,
            headers: headersList
        }, 5000)
 
        const data = await response.text();

        // Parse the XML response
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(data, "application/xml");

        const items = xmlDoc.getElementsByTagName("item");
        const stockList = Array.from(items).map(item => ({
            prd_id: item.getElementsByTagName("prd_id")[0]?.textContent,
            stock_ean13: item.getElementsByTagName("stock_ean13")[0]?.textContent,
            stock_qt: item.getElementsByTagName("stock_qt")[0]?.textContent,
            stock_actif: item.getElementsByTagName("stock_actif")[0]?.textContent,
            stock_suivi: item.getElementsByTagName("stock_suivi")[0]?.textContent,
            stock_taille: item.getElementsByTagName("stock_taille")[0]?.textContent || '',
            stock_couleur: item.getElementsByTagName("stock_couleur")[0]?.textContent || '',
        }));


        // Optional: Transform stock list as needed
        const formatStockList = transformStockList(stockList);
        await getProductInfo(formatStockList, connection); 

    } catch (error) {
        console.error("Error fetching or updating product data:", error);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
    }
}

export default fetchAndUpdateProductData;