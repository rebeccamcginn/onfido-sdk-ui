import { h } from 'preact'
import { useState, useEffect } from 'preact/compat'
import Autocomplete from 'accessible-autocomplete/preact'
import { omit } from 'lodash/fp'
import { allCountriesList, countryTranslations } from './countries'
import { CountryData } from '~types/commons'
import { getCountryFlagSrc } from '~supported-documents'
import styles from '../../CountrySelector/style.scss'

const getCountryOptionTemplate = (country) => {
  if (country) {
    const countryCode = country.countryCode
    const countryFlagSrc = getCountryFlagSrc(countryCode, 'square')
    return `<i
      role="presentation"
      class="${styles.countryFlag}"
      style="background-image: url(${countryFlagSrc})"></i>
      <span class="${styles.countryLabel}">${country.label}</span>`
  }
  return ''
}

const options = allCountriesList.map((country) => ({
  ...omit('labelKey', country),
  label: countryTranslations[country.labelKey.replace('countriesList.', '')],
}))

const findEntry = (value) =>
  options.find(
    (entry) => entry.countryCode === value || entry.isoAlpha3 === value
  )

const defaultCountry = 'GBR'

const CountrySelector = ({ value, error, onChange, ...props }) => {
  const [currentValue, setCurrentValue] = useState()
  //findEntry(value || defaultCountry)

  useEffect(() => {
    if (!value) onChange?.(defaultCountry)
  }, [])

  const handleChange = (selectedCountry) => {
    console.log(selectedCountry)
    setCurrentValue(selectedCountry.isoAlpha3)
    onChange?.(selectedCountry.isoAlpha3)
  }

  const suggestCountries = (query, populateResults) => {
    const filteredResults = options.filter((result) => {
      const country = result.label
      return country.toLowerCase().includes(query.trim().toLowerCase())
    })
    populateResults(filteredResults)
  }

  return (
    <div className={styles.countrySelector}>
      <Autocomplete
        id="country-search"
        source={suggestCountries}
        showAllValues
        dropdownArrow={() => <i className={styles.dropdownIcon} />}
        // placeholder={translate('country_select.search.input_placeholder')}
        //    tNoResults={() => this.getNoResultsTextForDropdown()}
        displayMenu="overlay"
        cssNamespace={'onfido-sdk-ui-CountrySelector-custom'}
        templates={{
          inputValue: (country) => country?.label,
          suggestion: (country) => getCountryOptionTemplate(country),
        }}
        onConfirm={handleChange}
        confirmOnBlur={false}
      />
    </div>
  )
}

export default CountrySelector
