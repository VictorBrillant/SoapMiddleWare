import dotenv from "dotenv";
import { DOMParser } from 'xmldom';

dotenv.config();
const SOAP_URL = process.env.SOAP_URL;
const API_LOG = process.env.API_LOG;
const API_KEY = process.env.API_KEY;

const getSID = async () => {
    const headersList = {
        "Accept": "*/*",
        "User-Agent": "Thunder Client (https://www.thunderclient.com)",
        "Content-Type": "text/xml",
        "SOAPAction": `${SOAP_URL}#AddCommande`
    };

    const bodyContent = 
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bus="https://soap.busyx.com/soap_pro.php">
        <soapenv:Header/>
        <soapenv:Body>
            <bus:GetSid>
                <api_log>625789</api_log>
                <api_key>789da23ef034810c2e3295fea47532a342ecf61e</api_key>
            </bus:GetSid>
        </soapenv:Body>
    </soapenv:Envelope>`;

    const getsid = await fetch(SOAP_URL, {
        method: "POST",
        headers: headersList,
        body: bodyContent
    });

    const result = await getsid.text();

    // Parse XML response
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(result, "application/xml");

    // Extract <return> value
    const returnValue = xmlDoc.getElementsByTagName("return")[0]?.textContent;

    return returnValue; // This should return "1021741068842"
};

const deleteCartItems = async (shopSID) => {

    const headersList = {
        "Accept": "*/*",
        "User-Agent": "Thunder Client (https://www.thunderclient.com)",
        "Content-Type": "text/xml",
        "SOAPAction": `${SOAP_URL}#CartGetData`
    };

    const bodyContent = 
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bus="https://soap.busyx.com/soap_pro.php">
        <soapenv:Header/>
        <soapenv:Body>
            <bus:CartGetData>
                <api_log>${API_LOG}</api_log>
                <api_key>${API_KEY}</api_key>
                <shopSID>${shopSID}</shopSID>
            </bus:CartGetData>
        </soapenv:Body>
    </soapenv:Envelope>`;

    try {
        const response = await fetch(SOAP_URL, {
            method: "POST",
            headers: headersList,
            body: bodyContent
        });

        const result = await response.text();

        // Parse XML response
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(result, "application/xml");

        // Extract <return> element
        const returnElement = xmlDoc.getElementsByTagName("return")[0];

        // Check if cart is empty
        const arrayType = returnElement?.getAttribute("SOAP-ENC:arrayType");
        if (arrayType === "tns:CaddiePrdItem[0]") {
            if(process.env.NODE_ENV === "development"){
                console.log("Cart is empty.");
            }
            
            return true;
        }

        // Extract item IDs from cart
        const items = xmlDoc.getElementsByTagName("item");
        let itemIDs = [];
        for (let i = 0; i < items.length; i++) {
            const id = items[i].getElementsByTagName("id")[0]?.textContent;
            if (id) itemIDs.push(id);
        }

        if(process.env.NODE_ENV === "development"){
            console.log("Items to delete:", itemIDs);
        }

        // Delete all items
        for (const ligneid of itemIDs) {
            await deleteCartItem(ligneid, shopSID);
        }

        if(process.env.NODE_ENV === "development"){
            console.log("All items deleted from cart.");
        }
        return true;

    } catch (error) {
        console.error("Error checking/deleting cart:", error);
        return false;
    }
};

// Function to delete a specific item from the cart
const deleteCartItem = async (ligneid, shopSID) => {

    const headersList = {
        "Accept": "*/*",
        "User-Agent": "Thunder Client (https://www.thunderclient.com)",
        "Content-Type": "text/xml",
        "SOAPAction": `${SOAP_URL}#CartDeleteLine`
    };

    const bodyContent = 
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bus="https://soap.busyx.com/soap_pro.php">
        <soapenv:Header/>
        <soapenv:Body>
            <bus:CartDeleteLine>
                <api_log>${API_LOG}</api_log>
                <api_key>${API_KEY}</api_key>
                <ligneid>${ligneid}</ligneid>
                <shopSID>${shopSID}</shopSID>
            </bus:CartDeleteLine>
        </soapenv:Body>
    </soapenv:Envelope>`;

    try {
        const response = await fetch(SOAP_URL, {
            method: "POST",
            headers: headersList,
            body: bodyContent
        });

        const result = await response.text();
        if(process.env.NODE_ENV === "development"){
            console.log(`Deleted item ${ligneid}`);
        }

    } catch (error) {
        console.error(`Error deleting item ${ligneid}:`, error);
    }
};

const compareOrders = async (connection) => {
    const [existingOrderShopify] = await connection.execute(
        `SELECT * FROM orders`
    );

    for(const order of existingOrderShopify){
        const [[existingOrderSoap]] = await connection.execute(
            `SELECT * FROM order_soap WHERE cde_ref_interne = ?`,
            [order.name]
        )
        const getsid = await getSID();
        await deleteCartItems(getsid);

        let lineNumber = 0;

        if (!existingOrderSoap) {

            const [lineItemsShopifyDetails] = await connection.execute(
                `SELECT * FROM line_items WHERE order_id = ?`,
                [
                    order.shopifyId
                ]
            );
            
            if(lineItemsShopifyDetails){

                const headersList = {
                    "Accept": "*/*",
                    "User-Agent": "Thunder Client (https://www.thunderclient.com)",
                    "Content-Type": "text/xml",
                    "SOAPAction": `${SOAP_URL}#CartAddItemPro`
                };

                for(const item of lineItemsShopifyDetails){
                    const [[productSoap]] = await connection.execute(
                        `SELECT * FROM stock_variants WHERE stock_ean13 = ?`,
                        [
                            item.sku
                        ]
                    );
                    if(productSoap){

                        const bodyContent = `
                            <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bus="${SOAP_URL}">
                                <soapenv:Header/>
                                <soapenv:Body>
                                    <bus:CartAddItemPro>
                                        <api_log>${API_LOG}</api_log>
                                        <api_key>${API_KEY}</api_key>
                                        <prd_id>${productSoap.prd_id}</prd_id>
                                        <taille>${productSoap.stock_taille}</taille>
                                        <couleur>${productSoap.stock_couleur}</couleur>
                                        <qte>${item.quantity}</qte>
                                        <shopSID>${getsid}</shopSID>
                                    </bus:CartAddItemPro>
                                </soapenv:Body>
                            </soapenv:Envelope>`;
                        
                        const addtocart = await fetch(SOAP_URL, {
                            method: "POST",
                            headers: headersList,
                            body: bodyContent
                        });
                
                        const resultaddtocart = await addtocart.text();
                        lineNumber = lineNumber + 1;
                    }
                }
                
            }
            if(lineNumber > 0){

                if(process.env.NODE_ENV === "development"){
                    console.log("CAN ADD COMMAND!!! for SID: ", getsid);
                }
                
                const cde_info = `
                    <cde_info>
                        <commande_noclient>${API_LOG}</commande_noclient>
                        <commande_lang>fr</commande_lang>
                        <commande_enseigne></commande_enseigne>
                        <commande_nom>${order.customer_last_name || ""}</commande_nom>
                        <commande_prenom>${order.customer_first_name || ""}</commande_prenom>
                        <commande_email>${order.email || ""}</commande_email>
                        <commande_rue>${order.shipping_address1 || ""}</commande_rue>
                        <commande_cp>${order.shipping_zip || ""}</commande_cp>
                        <commande_ville>${order.shipping_city || ""}</commande_ville>
                        <commande_pays>${order.shipping_country || ""}</commande_pays>
                        <commande_tel>${order.customer_phone || ""}</commande_tel>
                        <commande_port>0</commande_port>
                        <commande_totalttc>${order.total_price}</commande_totalttc>
                        <commande_mode_transport>1</commande_mode_transport>
                        <commande_geocountry>${order.shipping_country || "France"}</commande_geocountry>
                        <commande_geozone>1</commande_geozone>
                        <commande_user_ip>0.0.0.0</commande_user_ip>
                        <commande_ref_interne>${order.name}</commande_ref_interne>
                        <commande_SID>${getsid}</commande_SID>
                    </cde_info>`;

                const headersList = {
                    "Accept": "*/*",
                    "User-Agent": "Thunder Client (https://www.thunderclient.com)",
                    "Content-Type": "text/xml",
                    "SOAPAction": `${SOAP_URL}#AddCommande`
                };
        
                const bodyContent = `
                    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bus="${SOAP_URL}">
                        <soapenv:Header/>
                        <soapenv:Body>
                            <bus:AddCommande>
                                <api_log>${API_LOG}</api_log>
                                <api_key>${API_KEY}</api_key>
                                ${cde_info}
                            </bus:AddCommande>
                        </soapenv:Body>
                    </soapenv:Envelope>`;
                
                const response = await fetch(SOAP_URL, {
                    method: "POST",
                    headers: headersList,
                    body: bodyContent
                });
        
                const result = await response.text();
                if(process.env.NODE_ENV === "development"){
                    console.log(`SOAP Response for order ${order.name}`);
                }
            }
            
        }
    }
};



export default compareOrders;