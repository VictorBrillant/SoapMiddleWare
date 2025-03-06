import express from 'express';
import dotenv from 'dotenv';
import { pool } from "./src/config/db.js";
import fetchAllShopifyProducts from './src/service/fetchDataShopify.js';
import fetchAndUpdateProductData from './src/service/transformSoapIntoJson.js';
import syncProducts from './src/service/syncProduct.js';
import fetchAllCommands from './src/service/fetchCommandSoap.js';
import fetchCommands from './src/service/fetchCommandShopify.js';
import compareOrders from './src/service/syncOrder.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const apiLog = process.env.API_LOG;
const apiKey = process.env.API_KEY;
const actif = 1;

// Fonction pour démarrer la boucle infinie
const startSyncLoop = async () => {
    const connection = await pool.getConnection();

    while (true) {
        try {
            console.log("🔄 Synchronisation des produits...");

            await fetchAllShopifyProducts(connection);
            await fetchAndUpdateProductData(apiLog, apiKey, actif, connection);
            await syncProducts(connection);

            //Sync orders
            await fetchAllCommands(apiLog, apiKey, actif, connection);
            await fetchCommands(connection);
            await compareOrders(connection);

            console.log("✅ Synchronisation terminée. Attente avant la prochaine exécution...");
        } catch (err) {
            console.error("❌ Erreur durant la synchronisation:", err);
        }

        // Attendre 30 secondes avant la prochaine exécution
        await new Promise(resolve => setTimeout(resolve, 30000));
    }

};

// Démarrer la boucle après le lancement du serveur
app.listen(port, async () => {
    console.log(`🚀 Serveur en écoute sur le port ${port}`);
    await startSyncLoop(); // Lancer la boucle infinie après le démarrage du serveur
});
