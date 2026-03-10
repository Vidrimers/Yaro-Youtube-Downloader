const axios = require('axios');
const { Logger } = require('./utils');

/**
 * CryptoApiClient - класс для работы с API криптовалют
 * Получает балансы кошельков через публичные API
 */
class CryptoApiClient {
  /**
   * @param {Object} config - конфигурация с API URLs и ключами
   */
  constructor(config) {
    this.config = config;
    
    // Настройки для HTTP запросов
    this.httpTimeout = 10000; // 10 секунд
    this.maxRetries = 2;
  }

  /**
   * Получает баланс Kaspa кошелька
   * @param {string} address - адрес Kaspa кошелька
   * @returns {Promise<number|null>} - баланс в KAS или null при ошибке
   */
  async getKaspaBalance(address) {
    if (!address || !this.config.KASPA_API_URL) {
      return null;
    }

    try {
      // Убираем префикс kaspa: если есть
      const cleanAddress = address.replace('kaspa:', '');
      
      const response = await axios.get(
        `${this.config.KASPA_API_URL}/addresses/${cleanAddress}/balance`,
        { timeout: this.httpTimeout }
      );

      if (response.data && typeof response.data.balance !== 'undefined') {
        // Kaspa использует сомоши (1 KAS = 100,000,000 сомоши)
        const balanceInSomoshi = parseInt(response.data.balance, 10);
        const balanceInKas = balanceInSomoshi / 100000000;
        
        Logger.info('Kaspa balance retrieved', { 
          address: cleanAddress, 
          balance: balanceInKas 
        });
        
        return balanceInKas;
      }

      return 0;
    } catch (error) {
      Logger.warn('Failed to get Kaspa balance', { 
        address, 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Получает баланс TON кошелька
   * @param {string} address - адрес TON кошелька
   * @returns {Promise<number|null>} - баланс в TON или null при ошибке
   */
  async getTonBalance(address) {
    if (!address || !this.config.TON_API_URL) {
      return null;
    }

    try {
      const response = await axios.get(
        `${this.config.TON_API_URL}/getAddressBalance`,
        { 
          params: { address },
          timeout: this.httpTimeout 
        }
      );

      if (response.data && response.data.ok && response.data.result) {
        // TON использует нанотоны (1 TON = 1,000,000,000 нанотонов)
        const balanceInNanoton = parseInt(response.data.result, 10);
        const balanceInTon = balanceInNanoton / 1000000000;
        
        Logger.info('TON balance retrieved', { 
          address, 
          balance: balanceInTon 
        });
        
        return balanceInTon;
      }

      return 0;
    } catch (error) {
      Logger.warn('Failed to get TON balance', { 
        address, 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Получает баланс USDT (TRC-20) кошелька
   * @param {string} address - адрес TRON кошелька
   * @returns {Promise<number|null>} - баланс в USDT или null при ошибке
   */
  async getUsdtBalance(address) {
    if (!address || !this.config.TRON_API_URL) {
      return null;
    }

    try {
      // USDT TRC-20 contract address
      const usdtContractAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
      
      const headers = {};
      if (this.config.TRON_API_KEY) {
        headers['TRON-PRO-API-KEY'] = this.config.TRON_API_KEY;
      }

      const response = await axios.post(
        `${this.config.TRON_API_URL}/wallet/triggerconstantcontract`,
        {
          owner_address: address,
          contract_address: usdtContractAddress,
          function_selector: 'balanceOf(address)',
          parameter: this.encodeAddress(address)
        },
        { 
          headers,
          timeout: this.httpTimeout 
        }
      );

      if (response.data && response.data.constant_result && response.data.constant_result[0]) {
        const hexBalance = response.data.constant_result[0];
        // Конвертируем hex в число и делим на 10^6 (USDT имеет 6 десятичных знаков)
        const balanceInSun = parseInt(hexBalance, 16);
        const balanceInUsdt = balanceInSun / 1000000;
        
        Logger.info('USDT balance retrieved', { 
          address, 
          balance: balanceInUsdt 
        });
        
        return balanceInUsdt;
      }

      return 0;
    } catch (error) {
      Logger.warn('Failed to get USDT balance', { 
        address, 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Кодирует TRON адрес для вызова смарт-контракта
   * @private
   * @param {string} address - TRON адрес
   * @returns {string} - закодированный адрес
   */
  encodeAddress(address) {
    // Простое кодирование адреса для TRON API
    // Убираем префикс T и дополняем нулями до 64 символов
    const cleanAddress = address.replace(/^T/, '41');
    return cleanAddress.padStart(64, '0');
  }

  /**
   * Получает балансы всех настроенных кошельков
   * @returns {Promise<Object>} - объект с балансами всех кошельков
   */
  async getAllBalances() {
    const balances = {};

    // Получаем баланс Kaspa
    if (this.config.KASPA_ADDRESS) {
      balances.kaspa = await this.getKaspaBalance(this.config.KASPA_ADDRESS);
    }

    // Получаем баланс TON
    if (this.config.TON_ADDRESS) {
      balances.ton = await this.getTonBalance(this.config.TON_ADDRESS);
    }

    // Получаем баланс USDT
    if (this.config.USDT_ADDRESS) {
      balances.usdt = await this.getUsdtBalance(this.config.USDT_ADDRESS);
    }

    Logger.info('All balances retrieved', { balances });
    return balances;
  }

  /**
   * Форматирует баланс для отображения
   * @param {number|null} balance - баланс
   * @param {string} currency - валюта
   * @returns {string} - отформатированный баланс
   */
  formatBalance(balance, currency) {
    if (balance === null) {
      return `❌ Ошибка получения ${currency}`;
    }
    
    if (balance === 0) {
      return `0.00 ${currency}`;
    }

    // Форматируем с разделителями тысяч
    return balance.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6
    }) + ` ${currency}`;
  }

  /**
   * Создает сообщение с балансами для админа
   * @param {Object} balances - объект с балансами
   * @returns {string} - отформатированное сообщение
   */
  createBalanceMessage(balances) {
    let message = '💰 <b>Баланс кошельков:</b>\n\n';

    if (this.config.KASPA_ADDRESS) {
      message += `💎 <b>Kaspa:</b> ${this.formatBalance(balances.kaspa, 'KAS')}\n`;
    }

    if (this.config.TON_ADDRESS) {
      message += `💠 <b>TON:</b> ${this.formatBalance(balances.ton, 'TON')}\n`;
    }

    if (this.config.USDT_ADDRESS) {
      message += `💵 <b>USDT:</b> ${this.formatBalance(balances.usdt, 'USDT')}\n`;
    }

    if (!this.config.KASPA_ADDRESS && !this.config.TON_ADDRESS && !this.config.USDT_ADDRESS) {
      message += 'ℹ️ Кошельки не настроены';
    }

    return message;
  }
}

module.exports = CryptoApiClient;