import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

const connectDB = async () => {
    try {
        const connection = await pool.getConnection();
        console.log("✅ Connexion MySQL réussie !");
        connection.release(); // Libérer la connexion
    } catch (error) {
        console.error("❌ Erreur de connexion MySQL :", error);
        process.exit(1);
    }
};

export { pool, connectDB };