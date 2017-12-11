import { h, Component } from 'preact'
require('es6-promise/auto')

import style from './style.css'

const Loading = (i18n) => <div className={style.loading}>{i18n.t('cross_device.phone_number_input.loading')}</div>

class PhoneNumberInputLazy extends Component {
  constructor(props){
    super(props)
    this.state = {component: <Loading i18n={props.i18n} />}
    // This is the first step toward the implementation of code splitting and lazy loading for the cross device feature
    // For now we are only separating the mobile number validation from the main bundle
    // but we are aiming to extract the cross device feature into
    // a separate bundle that can be lazy loaded on demand, to avoid bloating the loading time of the browser page

    import(/* webpackChunkName: "crossDevice" */ './index.js').then(component => {
      this.setState({component})
    }).catch(() => this.props.i18n.t('errors.lazy_loading.message'));
  }

  render = (props)=> <this.state.component {...props}/>
}

export default PhoneNumberInputLazy
