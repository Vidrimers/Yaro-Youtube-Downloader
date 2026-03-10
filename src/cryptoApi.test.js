const CryptoApiClient = require('./cryptoApi');

describe('CryptoApiClient', () => {
  let cryptoApi;
  let mockConfig;

  beforeEach(() => {
    mockConfig = {
      KASPA_ADDRESS: 'kaspa:qzdkq9n6p0rgp7fg3cyhuq4uznfy6a4csh5jcqt4gs355zyf3r3t2eszhhc9c',
      TON_ADDRESS: 'UQB6VnvZJXUfq3CW-xS6ku38t3fIK7RJ30a5TMTGJiJal8tr',
      USDT_ADDRESS: 'TYYvAa7u8agTheFHoJK6sGqPV2E6UJd6Er',
      KASPA_API_URL: 'https://api.kaspa.org',
      TON_API_URL: 'https://toncenter.com/api/v2',
      TRON_API_URL: 'https://api.trongrid.io',
      TRON_API_KEY: 'test-key'
    };
    
    cryptoApi = new CryptoApiClient(mockConfig);
  });

  describe('formatBalance', () => {
    test('должен форматировать null как ошибку', () => {
      const result = cryptoApi.formatBalance(null, 'KAS');
      expect(result).toBe('❌ Ошибка получения KAS');
    });

    test('должен форматировать 0 как 0.00', () => {
      const result = cryptoApi.formatBalance(0, 'TON');
      expect(result).toBe('0.00 TON');
    });

    test('должен форматировать числа с разделителями', () => {
      const result = cryptoApi.formatBalance(1234.567890, 'USDT');
      expect(result).toContain('1');
      expect(result).toContain('234');
      expect(result).toContain('USDT');
    });
  });

  describe('createBalanceMessage', () => {
    test('должен создать сообщение с балансами', () => {
      const balances = {
        kaspa: 100.5,
        ton: 50.25,
        usdt: 1000.0
      };

      const message = cryptoApi.createBalanceMessage(balances);
      
      expect(message).toContain('💰');
      expect(message).toContain('Баланс кошельков');
      expect(message).toContain('💎');
      expect(message).toContain('Kaspa');
      expect(message).toContain('💠');
      expect(message).toContain('TON');
      expect(message).toContain('💵');
      expect(message).toContain('USDT');
    });

    test('должен показать сообщение о ненастроенных кошельках', () => {
      const emptyConfig = {};
      const emptyCryptoApi = new CryptoApiClient(emptyConfig);
      
      const message = emptyCryptoApi.createBalanceMessage({});
      
      expect(message).toContain('Кошельки не настроены');
    });

    test('должен обработать ошибки получения балансов', () => {
      const balances = {
        kaspa: null,
        ton: null,
        usdt: null
      };

      const message = cryptoApi.createBalanceMessage(balances);
      
      expect(message).toContain('❌ Ошибка получения KAS');
      expect(message).toContain('❌ Ошибка получения TON');
      expect(message).toContain('❌ Ошибка получения USDT');
    });
  });

  describe('encodeAddress', () => {
    test('должен кодировать TRON адрес', () => {
      const address = 'TYYvAa7u8agTheFHoJK6sGqPV2E6UJd6Er';
      const encoded = cryptoApi.encodeAddress(address);
      
      expect(encoded).toHaveLength(64);
      expect(encoded).toContain('41YYvAa7u8agTheFHoJK6sGqPV2E6UJd6Er');
    });
  });

  describe('getAllBalances', () => {
    test('должен вернуть объект с балансами', async () => {
      // Мокаем методы получения балансов
      cryptoApi.getKaspaBalance = jest.fn().mockResolvedValue(100);
      cryptoApi.getTonBalance = jest.fn().mockResolvedValue(50);
      cryptoApi.getUsdtBalance = jest.fn().mockResolvedValue(1000);

      const balances = await cryptoApi.getAllBalances();

      expect(balances).toHaveProperty('kaspa', 100);
      expect(balances).toHaveProperty('ton', 50);
      expect(balances).toHaveProperty('usdt', 1000);
    });

    test('должен пропустить ненастроенные кошельки', async () => {
      const configWithoutAddresses = {
        KASPA_API_URL: 'https://api.kaspa.org'
      };
      const cryptoApiEmpty = new CryptoApiClient(configWithoutAddresses);

      const balances = await cryptoApiEmpty.getAllBalances();

      expect(balances).toEqual({});
    });
  });
});