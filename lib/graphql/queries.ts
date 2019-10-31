export const GET_USER = `query {
  viewer {
    birthDate
    birthPlace
    businessPurpose
    city
    companyType
    country
    createdAt
    economicSector
    email
    firstName
    gender
    identificationLink
    identificationStatus
    isUSPerson
    lastName
    mobileNumber
    nationality
    otherEconomicSector
    postCode
    publicId
    referralCode
    street
    taxCutoffLine
    taxPaymentFrequency
    taxRate
    untrustedPhoneNumber
    vatCutoffLine
    vatNumber
    vatPaymentFrequency
    vatRate
  }
}`;

export const GET_ACCOUNT = `query {
  viewer {
    mainAccount {
      iban
      balance
    }
  }
}`;
