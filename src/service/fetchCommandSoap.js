
import dotenv from "dotenv";
import { DOMParser } from 'xmldom';

dotenv.config();

const SOAP_URL = process.env.SOAP_URL;

async function fetchAllCommands(apiLog, apiKey, idClient, connection) {
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
            <bus:GetTbCommandes>
                <api_log>${apiLog}</api_log>
                <api_key>${apiKey}</api_key>
                <params>
                    <id_client>
                        ${idClient}
                    </id_client>
                </params>
            </bus:GetTbCommandes>
        </soapenv:Body>
    </soapenv:Envelope>`;

    const response = await fetch(`${SOAP_URL}`, {
        method: "POST",
        body: bodyContent,
        headers: headersList
    });
    
    const data = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(data, "application/xml");

    const items = xmlDoc.getElementsByTagName("item");
    
    await Promise.all(Array.from(items).map(async (item) => {
        const cde_id = item.getElementsByTagName("cde_id")[0]?.textContent || null;

        const order =  {
            cde_id,
            cde_dt: item.getElementsByTagName("cde_dt")[0]?.textContent || '',
            cde_num: item.getElementsByTagName("cde_num")[0]?.textContent || '',
            cde_client_id: item.getElementsByTagName("cde_client_id")[0]?.textContent || '',
            cde_nom: item.getElementsByTagName("cde_nom")[0]?.textContent || '',
            cde_prenom: item.getElementsByTagName("cde_prenom")[0]?.textContent || '',
            cde_email: item.getElementsByTagName("cde_email")[0]?.textContent || '',
            cde_adresse: item.getElementsByTagName("cde_adresse")[0]?.textContent || '',
            cde_codepostal: item.getElementsByTagName("cde_codepostal")[0]?.textContent || '',
            cde_ville: item.getElementsByTagName("cde_ville")[0]?.textContent || '',
            cde_pays: item.getElementsByTagName("cde_pays")[0]?.textContent || '',
            cde_tel: item.getElementsByTagName("cde_tel")[0]?.textContent || '',
            cde_fax: item.getElementsByTagName("cde_fax")[0]?.textContent || '',
            cde_message: item.getElementsByTagName("cde_message")[0]?.textContent || '',
            cde_livraison_nom: item.getElementsByTagName("cde_livraison_nom")[0]?.textContent || '',
            cde_livraison_prenom: item.getElementsByTagName("cde_livraison_prenom")[0]?.textContent || '',
            cde_livraison_rue: item.getElementsByTagName("cde_livraison_rue")[0]?.textContent || '',
            cde_livraison_rue2: item.getElementsByTagName("cde_livraison_rue2")[0]?.textContent || '',
            cde_livraison_rue3: item.getElementsByTagName("cde_livraison_rue3")[0]?.textContent || '',
            cde_livraison_codepostal: item.getElementsByTagName("cde_livraison_codepostal")[0]?.textContent || '',
            cde_total_ht: parseFloat(item.getElementsByTagName("cde_total_ht")[0]?.textContent) || 0,
            cde_total_ttc: parseFloat(item.getElementsByTagName("cde_total_ttc")[0]?.textContent) || 0,
            cde_paiement: parseInt(item.getElementsByTagName("cde_paiement")[0]?.textContent, 10) || 0,
            cde_statut: parseInt(item.getElementsByTagName("cde_statut")[0]?.textContent, 10) || 0,
            cde_dt_paiement: item.getElementsByTagName("cde_dt_paiement")[0]?.textContent || '',
            cde_mode_transport: parseInt(item.getElementsByTagName("cde_mode_transport")[0]?.textContent, 10) || 0,
            cde_country: item.getElementsByTagName("cde_country")[0]?.textContent || '',
            cde_ref_interne: item.getElementsByTagName("cde_ref_interne")[0]?.textContent || '',
        };

        const [[existingOrderSoap]] = await connection.execute(
            `SELECT * FROM order_soap WHERE cde_id = ?`,
            [order.cde_id]
        )
        
        if(!existingOrderSoap){
            try {
                await connection.execute(
                    `INSERT INTO order_soap (
                        cde_id, cde_dt, cde_num, cde_client_id, cde_nom, cde_prenom, cde_email, 
                        cde_adresse, cde_codepostal, cde_ville, cde_pays, cde_tel, cde_fax, cde_message, 
                        cde_livraison_nom, cde_livraison_prenom, cde_livraison_rue, cde_livraison_rue2, 
                        cde_livraison_rue3, cde_livraison_codepostal, cde_total_ht, cde_total_ttc, 
                        cde_paiement, cde_statut, cde_dt_paiement, cde_mode_transport, cde_country, cde_ref_interne
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        order.cde_id,
                        order.cde_dt,
                        order.cde_num,
                        order.cde_client_id,
                        order.cde_nom,
                        order.cde_prenom,
                        order.cde_email,
                        order.cde_adresse,
                        order.cde_codepostal,
                        order.cde_ville,
                        order.cde_pays,
                        order.cde_tel,
                        order.cde_fax,
                        order.cde_message,
                        order.cde_livraison_nom,
                        order.cde_livraison_prenom,
                        order.cde_livraison_rue,
                        order.cde_livraison_rue2,
                        order.cde_livraison_rue3,
                        order.cde_livraison_codepostal,
                        order.cde_total_ht,
                        order.cde_total_ttc,
                        order.cde_paiement,
                        order.cde_statut,
                        order.cde_dt_paiement,
                        order.cde_mode_transport,
                        order.cde_country,
                        order.cde_ref_interne
                    ]
                );
                
            } catch (error) {
                console.log("Order: ", error.message)
            } 
        } 
    }));
}

export default fetchAllCommands;